package domain

import (
	"errors"
	"fmt"
	"time"
)

// Feature names (the keys of the catalog).
const (
	FeaturePhotoImport        = "photo_import"
	FeatureDailyStory         = "daily_story"
	FeatureWordSearch         = "word_search"
	FeatureStoryAutotranslate = "story_autotranslate"
	FeatureThemePicker        = "theme_picker"
)

// FeatureSpec describes a feature in the catalog. DefaultLimit nil = unlimited.
type FeatureSpec struct {
	Name         string
	DefaultLimit *int
	// DisabledByDefault: off until the admin turns it on for a user (an unfinished feature in testing).
	DisabledByDefault bool
}

func intp(n int) *int { return &n }

// FeatureCatalog is the ordered list of features; all are enabled by default except the ones marked.
var FeatureCatalog = []FeatureSpec{
	{Name: FeaturePhotoImport, DefaultLimit: intp(5)},
	{Name: FeatureDailyStory, DisabledByDefault: true},
	{Name: FeatureWordSearch},
	{Name: FeatureStoryAutotranslate},
	{Name: FeatureThemePicker},
}

// FeatureByName looks a feature up in the catalog.
func FeatureByName(name string) (FeatureSpec, bool) {
	for _, f := range FeatureCatalog {
		if f.Name == name {
			return f, true
		}
	}
	return FeatureSpec{}, false
}

func IsFeature(name string) bool {
	_, ok := FeatureByName(name)
	return ok
}

// FeatureState is a feature as one user sees it. DailyLimit is the effective limit (override or
// default); LimitOverride is what the admin set (nil = the default applies). Remaining is what is
// left of today's free units; Credits is the purchased balance, spent once those run out.
type FeatureState struct {
	Feature       string `json:"feature"`
	Enabled       bool   `json:"enabled"`
	DailyLimit    *int   `json:"daily_limit"`
	DefaultLimit  *int   `json:"default_limit"`
	LimitOverride *int   `json:"limit_override"`
	UsedToday     int    `json:"used_today"`
	Remaining     *int   `json:"remaining"`
	Credits       int    `json:"credits"`
}

// ConsumeResult says where the units of one Consume came from, so a Refund can give each back to
// its own source. DailyRemaining is what is left of today's free units afterwards (nil = the
// feature is unlimited); Credits is the purchased balance afterwards.
type ConsumeResult struct {
	FromDaily      int
	FromCredits    int
	DailyRemaining *int
	Credits        int
	// Day is the usage day the daily units were taken from (a refund after midnight returns them there).
	Day string
}

// FeatureOverride is a row of user_features.
type FeatureOverride struct {
	Enabled    bool
	DailyLimit *int
}

var (
	ErrFeatureDisabled = errors.New("feature is disabled")
	ErrDailyLimit      = errors.New("daily limit reached")
)

// DailyLimitError is ErrDailyLimit carrying the limit that was hit and the purchased balance, which
// did not cover the rest either.
type DailyLimitError struct {
	Limit   int
	Credits int
}

func (e *DailyLimitError) Error() string        { return fmt.Sprintf("daily limit reached (%d)", e.Limit) }
func (e *DailyLimitError) Is(target error) bool { return target == ErrDailyLimit }

// DailyLimitOf extracts the limit from an ErrDailyLimit.
func DailyLimitOf(err error) (int, bool) {
	var d *DailyLimitError
	if errors.As(err, &d) {
		return d.Limit, true
	}
	return 0, false
}

// CreditsOf extracts the purchased balance from an ErrDailyLimit.
func CreditsOf(err error) (int, bool) {
	var d *DailyLimitError
	if errors.As(err, &d) {
		return d.Credits, true
	}
	return 0, false
}

// FeatureTZ: "today" for daily limits is the calendar day in Tashkent. (Needs tzdata: main.go
// imports time/tzdata so it also works in the Docker image.)
var FeatureTZ = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Tashkent")
	if err != nil {
		return time.FixedZone("UTC+5", 5*3600) // Tashkent has no DST
	}
	return loc
}()

// FeatureDay is the usage day (YYYY-MM-DD) of t.
func FeatureDay(t time.Time) string { return t.In(FeatureTZ).Format("2006-01-02") }
