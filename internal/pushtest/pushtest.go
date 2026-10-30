// Package pushtest is for tests only: a pretend browser that owns a Web Push key pair and can read
// the notification a push service received (RFC 8291, aes128gcm), so tests can check what was sent.
package pushtest

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"

	"golang.org/x/crypto/hkdf"
)

// Browser holds the subscription keys a real browser would generate.
type Browser struct {
	P256dh string // base64url, the browser's public key
	Auth   string // base64url, the 16-byte auth secret
	key    *ecdh.PrivateKey
	auth   []byte
}

func NewBrowser() (*Browser, error) {
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		return nil, err
	}
	return &Browser{
		P256dh: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		Auth:   base64.RawURLEncoding.EncodeToString(auth),
		key:    key, auth: auth,
	}, nil
}

// Decrypt reads the body of a push request (content coding aes128gcm) and returns the message.
func (b *Browser) Decrypt(body []byte) ([]byte, error) {
	// header: salt(16) | record size(4) | key id length(1) | key id (the sender's public key)
	if len(body) < 21 {
		return nil, errors.New("body too short")
	}
	salt := body[:16]
	idLen := int(body[20])
	if len(body) < 21+idLen {
		return nil, errors.New("body too short for the key id")
	}
	senderPub := body[21 : 21+idLen]
	ciphertext := body[21+idLen:]
	_ = binary.BigEndian.Uint32(body[16:20]) // record size: a single record is enough here

	sender, err := ecdh.P256().NewPublicKey(senderPub)
	if err != nil {
		return nil, err
	}
	secret, err := b.key.ECDH(sender)
	if err != nil {
		return nil, err
	}
	keyInfo := append(append([]byte("WebPush: info\x00"), b.key.PublicKey().Bytes()...), senderPub...)
	ikm := make([]byte, 32)
	if _, err := io.ReadFull(hkdf.New(sha256.New, secret, b.auth, keyInfo), ikm); err != nil {
		return nil, err
	}
	cek := make([]byte, 16)
	if _, err := io.ReadFull(hkdf.New(sha256.New, ikm, salt, []byte("Content-Encoding: aes128gcm\x00")), cek); err != nil {
		return nil, err
	}
	nonce := make([]byte, 12)
	if _, err := io.ReadFull(hkdf.New(sha256.New, ikm, salt, []byte("Content-Encoding: nonce\x00")), nonce); err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	// strip the padding: zeros, then the delimiter (0x02 for the last record)
	plain = bytes.TrimRight(plain, "\x00")
	if len(plain) == 0 || (plain[len(plain)-1] != 0x02 && plain[len(plain)-1] != 0x01) {
		return nil, errors.New("missing padding delimiter")
	}
	return plain[:len(plain)-1], nil
}
