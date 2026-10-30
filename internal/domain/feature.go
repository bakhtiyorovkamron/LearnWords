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
)

// FeatureSpec describes a feature in the catalog. DefaultLimit nil = unlimited.
type FeatureSpec struct {
	Name         string
	DefaultLimit *int
}

func intp(n int) *int { return &n }

// FeatureCatalog is the ordered list of features; all are enabled by default.
var FeatureCatalog = []FeatureSpec{
	{Name: FeaturePhotoImport, DefaultLimit: intp(10)},
	{Name: FeatureDailyStory},
	{Name: FeatureWordSearch},
	{Name: FeatureStoryAutotranslate},
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
// default); LimitOverride is what the admin set (nil = the default applies).
type FeatureState struct {
	Feature       string `json:"feature"`
	Enabled       bool   `json:"enabled"`
	DailyLimit    *int   `json:"daily_limit"`
	DefaultLimit  *int   `json:"default_limit"`
	LimitOverride *int   `json:"limit_override"`
	UsedToday     int    `json:"used_today"`
	Remaining     *int   `json:"remaining"`
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

// DailyLimitError is ErrDailyLimit carrying the limit that was hit.
type DailyLimitError struct{ Limit int }

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
