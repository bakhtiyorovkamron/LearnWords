DELETE FROM credit_ledger WHERE reason = 'telegram';
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check CHECK (reason IN ('purchase', 'admin', 'refund'));
DROP TABLE IF EXISTS telegram_bonuses;
