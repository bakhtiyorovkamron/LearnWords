package postgres

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"learnwords/internal/domain"
)

// PurchaseRepository stores purchase requests (manual card payments) and grants their credits.
type PurchaseRepository struct {
	pool  *pgxpool.Pool
	codes func() string // the next code to try
}

func NewPurchaseRepository(pool *pgxpool.Pool) *PurchaseRepository {
	return &PurchaseRepository{pool: pool, codes: randomPurchaseCode}
}

// randomPurchaseCode: "YD-" + 4 random digits. Not a secret, only a reference for the transfer comment.
func randomPurchaseCode() string { return fmt.Sprintf("YD-%04d", rand.IntN(10000)) }

// codeAttempts: tries for a code no other pending request holds (10 000 codes, reused once decided).
const codeAttempts = 20

// purchaseLockClass namespaces the per-user advisory lock of Create (two-key form, so it never
// collides with single-key locks such as the migration lock).
const purchaseLockClass = 45

// The last column is the newest chat message of the request's thread (NULL without one).
const purchaseCols = `p.id, p.user_id, p.code, p.pack_id, p.feature, p.amount, p.price_uzs, p.status,
	p.created_at, p.decided_at, p.decided_by,
	(SELECT t.last_message_at FROM chat_threads t WHERE t.kind = 'purchase' AND t.purchase_request_id = p.id)`

func scanPurchase(row pgx.Row, extra ...any) (domain.PurchaseRequest, error) {
	var p domain.PurchaseRequest
	dest := append([]any{&p.ID, &p.UserID, &p.Code, &p.PackID, &p.Feature, &p.Amount, &p.PriceUZS, &p.Status,
		&p.CreatedAt, &p.DecidedAt, &p.DecidedBy, &p.LastMessageAt}, extra...)
	err := row.Scan(dest...)
	return p, err
}

// Create stores a pending request for pack under a fresh code, retrying on a code collision. When
// the user already has maxPending pending requests it is ErrTooManyPending. The count and the
// insert run under a per-user advisory lock, so parallel requests cannot pass the cap together.
func (r *PurchaseRepository) Create(ctx context.Context, userID uuid.UUID, pack domain.Pack, maxPending int) (domain.PurchaseRequest, error) {
	for range codeAttempts {
		p, err := r.create(ctx, userID, pack, maxPending, r.codes())
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" { // the code is held by another pending request
			continue
		}
		return p, err
	}
	return domain.PurchaseRequest{}, errors.New("no free purchase code")
}

func (r *PurchaseRepository) create(ctx context.Context, userID uuid.UUID, pack domain.Pack, maxPending int, code string) (domain.PurchaseRequest, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1, hashtext($2))`, purchaseLockClass, userID.String()); err != nil {
		return domain.PurchaseRequest{}, err
	}
	pending, err := countPending(ctx, tx, userID)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	if pending >= maxPending {
		return domain.PurchaseRequest{}, domain.ErrTooManyPending
	}
	p, err := scanPurchase(tx.QueryRow(ctx, `
		INSERT INTO purchase_requests AS p (user_id, code, pack_id, feature, amount, price_uzs)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+purchaseCols, userID, code, pack.ID, pack.Feature, pack.Amount, pack.PriceUZS))
	if err != nil {
		return domain.PurchaseRequest{}, notFoundOnFK(err)
	}
	return p, tx.Commit(ctx)
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func countPending(ctx context.Context, q queryRower, userID uuid.UUID) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM purchase_requests WHERE user_id = $1 AND status = 'pending'`, userID).Scan(&n)
	return n, err
}

// CountPending: how many of the user's requests wait for an admin.
func (r *PurchaseRepository) CountPending(ctx context.Context, userID uuid.UUID) (int, error) {
	return countPending(ctx, r.pool, userID)
}

// ListByUser returns the user's latest requests, newest first.
func (r *PurchaseRepository) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.PurchaseRequest, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+purchaseCols+` FROM purchase_requests p
		WHERE p.user_id = $1 ORDER BY p.created_at DESC, p.id LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.PurchaseRequest, error) { return scanPurchase(row) })
}

// ListByStatus returns requests in one status ("" = any), newest first, with the user's email and
// the chat messages from the buyer no admin has read yet.
func (r *PurchaseRepository) ListByStatus(ctx context.Context, status string, limit int) ([]domain.PurchaseRequest, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+purchaseCols+`, u.email, `+unreadCol+` FROM purchase_requests p JOIN users u ON u.id = p.user_id
		WHERE $1::text = '' OR p.status = $1::text
		ORDER BY p.created_at DESC, p.id LIMIT $2`, status, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.PurchaseRequest, error) {
		var (
			email  string
			unread int
		)
		p, err := scanPurchase(row, &email, &unread)
		p.UserEmail, p.Unread = email, unread
		return p, err
	})
}

// Cancel withdraws the user's own pending request and leaves "cancelled" in its chat. Someone
// else's, a decided or a missing one is ErrPurchaseNotFound.
func (r *PurchaseRepository) Cancel(ctx context.Context, userID, id uuid.UUID) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	p, err := scanPurchase(tx.QueryRow(ctx, `
		UPDATE purchase_requests p SET status = 'cancelled', decided_at = now()
		WHERE p.id = $1 AND p.user_id = $2 AND p.status = 'pending'
		RETURNING `+purchaseCols, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrPurchaseNotFound
	}
	if err != nil {
		return err
	}
	if err := systemMessage(ctx, tx, p); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Approve marks a pending request paid and adds its credits (ledger reason "purchase") in one
// transaction. Only a pending request can be approved: a decided one is ErrPurchaseDecided and its
// credits are not added again — two approvals racing each other add them once.
func (r *PurchaseRepository) Approve(ctx context.Context, id, adminID uuid.UUID) (domain.PurchaseRequest, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	p, err := decide(ctx, tx, id, adminID, domain.PurchasePaid)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	if _, err := addCredits(ctx, tx, p.UserID, p.Feature, p.Amount, domain.CreditPurchase, &p.ID, &adminID, p.Code); err != nil {
		return domain.PurchaseRequest{}, err
	}
	return p, tx.Commit(ctx)
}

// Reject marks a pending request rejected (no credits). A decided one is ErrPurchaseDecided.
func (r *PurchaseRepository) Reject(ctx context.Context, id, adminID uuid.UUID) (domain.PurchaseRequest, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // a no-op after Commit
	p, err := decide(ctx, tx, id, adminID, domain.PurchaseRejected)
	if err != nil {
		return domain.PurchaseRequest{}, err
	}
	return p, tx.Commit(ctx)
}

// decide moves a pending request to status (with the user's email, as in the admin listing). The
// status = 'pending' guard is what makes a decision happen once: a second UPDATE waits for the
// first and then matches nothing.
func decide(ctx context.Context, tx pgx.Tx, id, adminID uuid.UUID, status string) (domain.PurchaseRequest, error) {
	var email string
	p, err := scanPurchase(tx.QueryRow(ctx, `
		UPDATE purchase_requests p SET status = $3, decided_at = now(), decided_by = $2
		FROM users u
		WHERE p.id = $1 AND p.status = 'pending' AND u.id = p.user_id
		RETURNING `+purchaseCols+`, u.email`, id, adminID, status), &email)
	p.UserEmail = email
	if err == nil {
		// The decision is written into the request's chat in the same transaction.
		return p, systemMessage(ctx, tx, p)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return p, err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM purchase_requests WHERE id = $1)`, id).Scan(&exists); err != nil {
		return domain.PurchaseRequest{}, err
	}
	if exists {
		return domain.PurchaseRequest{}, domain.ErrPurchaseDecided
	}
	return domain.PurchaseRequest{}, domain.ErrPurchaseNotFound
}

// AdminIDs returns the admins who are not banned (they are told about new requests).
func (r *PurchaseRepository) AdminIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `SELECT id FROM users WHERE role = 'admin' AND NOT is_banned ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}
