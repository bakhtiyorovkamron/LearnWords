package service

import (
	"strings"
	"testing"
)

func TestImageDataURL(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
	got, err := imageDataURL(png)
	if err != nil || !strings.HasPrefix(got, "data:image/png;base64,") {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := imageDataURL([]byte("not an image")); err == nil {
		t.Fatal("expected error for non-image")
	}
	if _, err := imageDataURL(nil); err == nil {
		t.Fatal("expected error for empty")
	}
}
