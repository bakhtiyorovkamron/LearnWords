// Command vapidkeys prints a fresh VAPID key pair for Web Push, in .env format:
//
//	go run ./cmd/vapidkeys >> .env
package main

import (
	"fmt"
	"os"

	"github.com/SherClockHolmes/webpush-go"
)

func main() {
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot generate VAPID keys:", err)
		os.Exit(1)
	}
	fmt.Printf("VAPID_PUBLIC_KEY=%s\n", public)
	fmt.Printf("VAPID_PRIVATE_KEY=%s\n", private)
	fmt.Println("VAPID_SUBJECT=mailto:admin@example.com # change to a real address you own")
}
