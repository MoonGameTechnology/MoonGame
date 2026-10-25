package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/quic-go/quic-go/http3"
)

func main() {
	if len(os.Args) != 5 {
		panic("endpoint ca path header-size required")
	}
	ca, err := os.ReadFile(os.Args[2])
	if err != nil {
		panic(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		panic("invalid CA")
	}
	n, err := strconv.Atoi(os.Args[4])
	if err != nil || n < 0 || n > 32768 {
		panic("invalid header size")
	}
	transport := &http3.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: "play.example.test", MinVersion: tls.VersionTLS13}}
	defer transport.Close()
	client := &http.Client{Transport: transport, Timeout: 8 * time.Second}
	req, err := http.NewRequest("GET", "https://"+os.Args[1]+os.Args[3], nil)
	if err != nil {
		panic(err)
	}
	req.Host = "play.example.test"
	req.Header.Set("User-Agent", "MoonGame-WAF-probe")
	req.Header.Set("Accept", "*/*")
	if n > 0 {
		req.Header.Set("X-Fill", strings.Repeat("a", n))
	}
	res, err := client.Do(req)
	if err != nil {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"error": err.Error()})
		return
	}
	defer res.Body.Close()
	count, readErr := io.Copy(io.Discard, io.LimitReader(res.Body, 3*1024*1024))
	json.NewEncoder(os.Stdout).Encode(map[string]any{"status": res.StatusCode, "protocol": res.Proto, "bytes": count, "read_error": readErr != nil})
}
