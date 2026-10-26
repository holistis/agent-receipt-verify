// Usage: go run . <out.json>
// Measures Go net/url, net/http and Gin handling of repeated query keys and cross-name order.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"runtime"
	"strings"

	"github.com/gin-gonic/gin"
)

var REP = map[string]string{"ab": "q=a&q=b", "ba": "q=b&q=a"}
var CROSS = map[string]string{"ab": "a=1&b=2", "ba": "b=2&a=1"}

type Obs struct {
	Single  *string  `json:"single"`
	All     []string `json:"all"`
	Keys    []string `json:"keys"`
	Orders  int      `json:"distinct_key_orders_over_300_iterations"`
}

func observe(v url.Values, single *string, all []string) Obs {
	seen := map[string]bool{}
	var first []string
	for i := 0; i < 300; i++ {
		var ks []string
		for k := range v {
			ks = append(ks, k)
		}
		seen[strings.Join(ks, ",")] = true
		if i == 0 {
			first = ks
		}
	}
	return Obs{Single: single, All: all, Keys: first, Orders: len(seen)}
}

func sp(s string) *string { return &s }

type Lib struct {
	Lib, Version, Transport, SingleAccessor, AllAccessor string
	Fn                                                    func(qs string) Obs
}

func fetch(base, qs string) Obs {
	resp, err := http.Get(base + "/?" + qs)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var o Obs
	if err := json.Unmarshal(b, &o); err != nil {
		panic(fmt.Sprintf("%v: %s", err, string(b)))
	}
	return o
}

func main() {
	out := os.Args[1]
	gin.SetMode(gin.ReleaseMode)

	// net/http, r.URL.Query()
	mux1 := http.NewServeMux()
	mux1.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		s := q.Get("q")
		var sPtr *string
		if q.Has("q") {
			sPtr = &s
		}
		json.NewEncoder(w).Encode(observe(q, sPtr, q["q"]))
	})
	s1 := httptest.NewServer(mux1)
	defer s1.Close()

	// net/http, r.FormValue / r.Form
	mux2 := http.NewServeMux()
	mux2.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		s := r.FormValue("q")
		var sPtr *string
		if _, ok := r.Form["q"]; ok {
			sPtr = &s
		}
		json.NewEncoder(w).Encode(observe(r.Form, sPtr, r.Form["q"]))
	})
	s2 := httptest.NewServer(mux2)
	defer s2.Close()

	// Gin
	g := gin.New()
	g.GET("/", func(c *gin.Context) {
		s, ok := c.GetQuery("q")
		var sPtr *string
		if ok {
			sPtr = &s
		}
		// gin exposes no key iteration of its own; keys come from the underlying url.Values
		c.JSON(200, observe(c.Request.URL.Query(), sPtr, c.QueryArray("q")))
	})
	s3 := httptest.NewServer(g)
	defer s3.Close()

	gv := "?"
	if bi, ok := readGinVersion(); ok {
		gv = bi
	}

	libs := []Lib{
		{"Go net/url ParseQuery", runtime.Version(), "in-process", "Values.Get(\"q\")", "Values[\"q\"]", func(qs string) Obs {
			v, _ := url.ParseQuery(qs)
			s := v.Get("q")
			var sPtr *string
			if v.Has("q") {
				sPtr = &s
			}
			return observe(v, sPtr, v["q"])
		}},
		{"Go net/http r.URL.Query()", runtime.Version(), "real-http", "r.URL.Query().Get(\"q\")", "r.URL.Query()[\"q\"]", func(qs string) Obs { return fetch(s1.URL, qs) }},
		{"Go net/http r.FormValue / r.Form", runtime.Version(), "real-http", "r.FormValue(\"q\")", "r.Form[\"q\"]", func(qs string) Obs { return fetch(s2.URL, qs) }},
		{"Gin c.Query / c.QueryArray", gv, "real-http", "c.GetQuery(\"q\")", "c.QueryArray(\"q\")", func(qs string) Obs { return fetch(s3.URL, qs) }},
	}

	type Row struct {
		Lib            string                    `json:"lib"`
		Version        string                    `json:"version"`
		Transport      string                    `json:"transport"`
		SingleAccessor string                    `json:"single_accessor"`
		AllAccessor    string                    `json:"all_accessor"`
		Rep            map[string]map[string]any `json:"rep"`
		Cross          map[string]map[string]any `json:"cross"`
		Extra          map[string]any            `json:"extra,omitempty"`
	}
	var rows []Row
	for _, L := range libs {
		r := Row{L.Lib, L.Version, L.Transport, L.SingleAccessor, L.AllAccessor, map[string]map[string]any{}, map[string]map[string]any{}, map[string]any{}}
		for k, qs := range REP {
			o := L.Fn(qs)
			r.Rep[k] = map[string]any{"qs": "?" + qs, "single": o.Single, "all": o.All, "keys": o.Keys}
		}
		for k, qs := range CROSS {
			o := L.Fn(qs)
			r.Cross[k] = map[string]any{"qs": "?" + qs, "keys": o.Keys, "distinct_key_orders_over_300_iterations": o.Orders}
		}
		rows = append(rows, r)
	}
	// Encode() order
	v1, _ := url.ParseQuery(CROSS["ab"])
	v2, _ := url.ParseQuery(CROSS["ba"])
	extra := map[string]any{"Values.Encode() for a=1&b=2": v1.Encode(), "Values.Encode() for b=2&a=1": v2.Encode()}
	rows[0].Extra = extra
	b, _ := json.MarshalIndent(rows, "", "  ")
	os.WriteFile(out, b, 0644)
	for _, r := range rows {
		fmt.Println(r.Lib, "|", r.Rep["ab"]["single"], r.Rep["ba"]["single"], "|", r.Rep["ab"]["all"], r.Rep["ba"]["all"], "|", r.Cross["ab"]["distinct_key_orders_over_300_iterations"], r.Cross["ba"]["distinct_key_orders_over_300_iterations"])
	}
	fmt.Println(extra)
}
