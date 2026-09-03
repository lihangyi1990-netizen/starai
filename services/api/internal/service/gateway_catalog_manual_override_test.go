package service

import (
	"reflect"
	"testing"
)

func TestGatewayCatalogTransportChanged(t *testing.T) {
	cases := []struct {
		name                              string
		oldCategory, oldEndpoint, oldMode string
		newCategory, newEndpoint, newMode string
		want                              bool
	}{
		{
			name:        "identical values are not an override",
			oldCategory: "chat", oldEndpoint: "/v1/chat/completions", oldMode: "chat_completions",
			newCategory: "chat", newEndpoint: "/v1/chat/completions", newMode: "chat_completions",
			want: false,
		},
		{
			name:        "category correction is an override",
			oldCategory: "video", oldEndpoint: "/v1/videos", oldMode: "video",
			newCategory: "audio", newEndpoint: "/v1/videos", newMode: "video",
			want: true,
		},
		{
			name:        "endpoint correction alone is an override",
			oldCategory: "audio", oldEndpoint: "/v1/videos", oldMode: "audio",
			newCategory: "audio", newEndpoint: "/v1/audio/speech", newMode: "audio",
			want: true,
		},
		{
			name:        "request mode correction alone is an override",
			oldCategory: "audio", oldEndpoint: "/v1/audio/speech", oldMode: "video",
			newCategory: "audio", newEndpoint: "/v1/audio/speech", newMode: "audio",
			want: true,
		},
		{
			name:        "whitespace only differences are not an override",
			oldCategory: "chat", oldEndpoint: "/v1/chat/completions", oldMode: "chat_completions",
			newCategory: " chat ", newEndpoint: "/v1/chat/completions", newMode: " chat_completions ",
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := gatewayCatalogTransportChanged(tc.oldCategory, tc.oldEndpoint, tc.oldMode, tc.newCategory, tc.newEndpoint, tc.newMode)
			if got != tc.want {
				t.Fatalf("gatewayCatalogTransportChanged = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestRetagGatewayCatalogCategory(t *testing.T) {
	cases := []struct {
		name        string
		tags        []string
		oldCategory string
		newCategory string
		want        []string
	}{
		{
			name: "auto generated single tag follows the category",
			tags: []string{"video"}, oldCategory: "video", newCategory: "audio",
			want: []string{"audio"},
		},
		{
			name: "curated tags are left alone",
			tags: []string{"video", "推荐"}, oldCategory: "video", newCategory: "audio",
			want: []string{"video", "推荐"},
		},
		{
			name: "a single tag an operator chose is left alone",
			tags: []string{"推荐"}, oldCategory: "video", newCategory: "audio",
			want: []string{"推荐"},
		},
		{
			name: "empty tags are left alone",
			tags: nil, oldCategory: "video", newCategory: "audio",
			want: nil,
		},
		{
			name: "an empty new category never clears the tag",
			tags: []string{"video"}, oldCategory: "video", newCategory: "",
			want: []string{"video"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := retagGatewayCatalogCategory(tc.tags, tc.oldCategory, tc.newCategory)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("retagGatewayCatalogCategory = %v, want %v", got, tc.want)
			}
		})
	}
}
