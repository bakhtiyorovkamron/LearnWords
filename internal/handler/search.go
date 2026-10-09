package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"learnwords/internal/domain"
	"learnwords/internal/service"
)

type SearchHandler struct{ svc *service.SearchService }

func NewSearchHandler(svc *service.SearchService) *SearchHandler { return &SearchHandler{svc: svc} }

// Search handles POST /api/search-word {"query": "...", "native_language": "uz"|"ru"|"en"}.
// native_language = the user's UI/native language: the query is most likely written in it and
// translations come back in it. The learning language comes from the account (ActiveUser).
// "translation_language" is accepted as an alias for older frontends.
func (h *SearchHandler) Search(c *gin.Context) {
	var req struct {
		Query               string `json:"query"`
		NativeLanguage      string `json:"native_language"`
		TranslationLanguage string `json:"translation_language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "query is required")
		return
	}
	native := req.NativeLanguage
	if native == "" {
		native = req.TranslationLanguage
	}
	ctx := domain.WithTranslationLang(c.Request.Context(), native)
	info, err := h.svc.Search(ctx, userID(c), req.Query)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

// Add handles POST /api/search-word/add — saves a found word with its ready translation,
// pronunciation and example. 409 if the same spelling is already in the collection.
func (h *SearchHandler) Add(c *gin.Context) {
	var req struct {
		Word               string `json:"word" binding:"max=100"`
		Translation        string `json:"translation" binding:"max=500"`
		Pronunciation      string `json:"pronunciation" binding:"max=200"`
		ExampleSentence    string `json:"example_sentence" binding:"max=500"`
		ExampleTranslation string `json:"example_translation" binding:"max=500"`
		FolderID           string `json:"folder_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "invalid body")
		return
	}
	folder, err := parseOptionalFolder(req.FolderID)
	if err != nil {
		writeError(c, err)
		return
	}
	res, err := h.svc.Add(c.Request.Context(), userID(c), service.AddInput{
		Word: req.Word, Translation: req.Translation, Pronunciation: req.Pronunciation,
		ExampleSentence: req.ExampleSentence, ExampleTranslation: req.ExampleTranslation, FolderID: folder,
	})
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}
