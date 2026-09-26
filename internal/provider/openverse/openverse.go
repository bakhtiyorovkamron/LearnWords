// Package openverse searches openly licensed photos via the Openverse API (no API key required).
// Docs: https://api.openverse.org/v1/
package openverse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"learnwords/internal/domain"
)

const defaultBaseURL = "https://api.openverse.org/v1/images/"

type Client struct {
	baseURL string
	http    *http.Client
}

func New() *Client {
	return &Client{baseURL: defaultBaseURL, http: &http.Client{Timeout: 8 * time.Second}}
}

type response struct {
	Results []struct {
		URL               string `json:"url"`
		Thumbnail         string `json:"thumbnail"`
		Title             string `json:"title"`
		Creator           string `json:"creator"`
		License           string `json:"license"`
		LicenseVersion    string `json:"license_version"`
		ForeignLandingURL string `json:"foreign_landing_url"`
	} `json:"results"`
}

func (c *Client) Search(ctx context.Context, query string, limit int) ([]domain.Photo, error) {
	q := url.Values{}
	q.Set("q", query)
	q.Set("page_size", strconv.Itoa(limit))
	q.Set("mature", "false")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "LearnWords/0.1 (language learning app)")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openverse request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openverse status %d", resp.StatusCode)
	}

	var r response
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, fmt.Errorf("openverse decode: %w", err)
	}

	photos := make([]domain.Photo, 0, len(r.Results))
	for _, it := range r.Results {
		if !strings.HasPrefix(it.URL, "https://") {
			continue
		}
		// Openverse-proxied thumbnail: https, stable, not blocked by hotlink protection.
		display := it.Thumbnail
		if display == "" {
			display = it.URL
		}
		photos = append(photos, domain.Photo{
			URL:       display,
			Original:  it.URL,
			Credit:    credit(it.Title, it.Creator, it.License, it.LicenseVersion),
			SourceURL: it.ForeignLandingURL,
		})
	}
	return photos, nil
}

func credit(title, creator, license, version string) string {
	parts := make([]string, 0, 3)
	if title != "" {
		parts = append(parts, "«"+title+"»")
	}
	if creator != "" {
		parts = append(parts, creator)
	}
	if license != "" {
		parts = append(parts, strings.ToUpper(strings.TrimSpace("CC "+license+" "+version)))
	}
	return strings.Join(parts, " · ")
}
