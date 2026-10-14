package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type ContextHandler struct{ svc *service.ContextService }

func NewContextHandler(svc *service.ContextService) *ContextHandler { return &ContextHandler{svc: svc} }

type createContextJSON struct {
	Text               string `json:"text" binding:"required,max=2000"`
	Meaning            string `json:"meaning" binding:"max=500"`
	Pronunciation      string `json:"pronunciation" binding:"max=200"`
	ExampleSentence    string `json:"example_sentence" binding:"max=500"`
	ExampleTranslation string `json:"example_translation" binding:"max=500"`
	Language           string `json:"language"`
	FolderID           string `json:"folder_id"`
	grammarJSON
}

// grammarJSON: optional result of POST /api/words/check that the user accepted.
type grammarJSON struct {
	Lemma        string `json:"lemma"`
	Article      string `json:"article"`
	Plural       string `json:"plural"`
	PartOfSpeech string `json:"part_of_speech"`
}

// grammar returns nil when no lemma was sent (word not checked / "keep as is").
func (g grammarJSON) grammar() *domain.WordGrammar {
	if strings.TrimSpace(g.Lemma) == "" {
		return nil
	}
	return &domain.WordGrammar{Lemma: g.Lemma, Article: optional(g.Article), Plural: optional(g.Plural),
		PartOfSpeech: strings.TrimSpace(g.PartOfSpeech)}
}

func optional(s string) *string {
	if s = strings.TrimSpace(s); s == "" {
		return nil
	}
	return &s
}

// parseOptionalFolder: "" → nil (no folder), otherwise a UUID.
func parseOptionalFolder(s string) (*uuid.UUID, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "none" {
		return nil, nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid folder_id", domain.ErrValidation)
	}
	return &id, nil
}

// Create accepts multipart/form-data (text, meaning, language) or JSON {"text","meaning","language"}.
func (h *ContextHandler) Create(c *gin.Context) {
	var in service.CreateContextInput
	var folder string
	if strings.HasPrefix(c.ContentType(), "multipart/") {
		in.Text = c.PostForm("text")
		in.Meaning = c.PostForm("meaning")
		in.Pronunciation = c.PostForm("pronunciation")
		in.ExampleSentence = c.PostForm("example_sentence")
		in.ExampleTranslation = c.PostForm("example_translation")
		in.Language = c.PostForm("language")
		folder = c.PostForm("folder_id")
		in.Grammar = grammarJSON{Lemma: c.PostForm("lemma"), Article: c.PostForm("article"),
			Plural: c.PostForm("plural"), PartOfSpeech: c.PostForm("part_of_speech")}.grammar()
		if strings.TrimSpace(in.Text) == "" || len([]rune(in.Text)) > 2000 {
			badRequest(c, "text is required (max 2000 chars)")
			return
		}
	} else {
		var req createContextJSON
		if err := c.ShouldBindJSON(&req); err != nil {
			badRequest(c, "text is required (max 2000 chars)")
			return
		}
		in = service.CreateContextInput{Text: req.Text, Meaning: req.Meaning, Pronunciation: req.Pronunciation,
			ExampleSentence: req.ExampleSentence, ExampleTranslation: req.ExampleTranslation, Language: req.Language,
			Grammar: req.grammar()}
		folder = req.FolderID
	}
	folderID, err := parseOptionalFolder(folder)
	if err != nil {
		writeError(c, err)
		return
	}
	in.FolderID = folderID

	res, err := h.svc.Create(c.Request.Context(), userID(c), in)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *ContextHandler) List(c *gin.Context) {
	limit, offset := pagination(c)
	items, err := h.svc.List(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "limit": limit, "offset": offset})
}

func (h *ContextHandler) Words(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	items, err := h.svc.Words(c.Request.Context(), userID(c), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *ContextHandler) WordCards(c *gin.Context) {
	limit, offset := pagination(c)
	items, err := h.svc.Cards(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "limit": limit, "offset": offset})
}

func (h *ContextHandler) RegenerateAudio(c *gin.Context) {
	id, ok := pathUUID(c, "id")
	if !ok {
		return
	}
	card, err := h.svc.RegenerateAudio(c.Request.Context(), userID(c), id)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, card)
}
