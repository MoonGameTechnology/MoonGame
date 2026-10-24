// Verified, bounded HTTPS loopback healthcheck for minimal monitoring images.
package main

import (
	"crypto/tls"
	"crypto/x509"
	"flag"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	caFile := flag.String("ca", "/transport/ca.crt", "trusted CA file")
	name := flag.String("name", "localhost", "verified TLS server identity")
	port := flag.Int("port", 0, "local port")
	path := flag.String("path", "/ready", "health path")
	flag.Parse()
	fail := func() { os.Exit(1) }
	if *port < 1 || *port > 65535 || !strings.HasPrefix(*path, "/") || strings.ContainsAny(*path, "\r\n") {
		fail()
	}
	ca, err := os.ReadFile(*caFile)
	if err != nil {
		fail()
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		fail()
	}
	client := &http.Client{
		Timeout:       2 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: *name, MinVersion: tls.VersionTLS12},
		},
	}
	response, err := client.Get("https://127.0.0.1:" + strconv.Itoa(*port) + *path)
	if err != nil {
		fail()
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		fail()
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 8192))
}
