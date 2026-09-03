package service

import (
	"strings"
	"testing"
)

func imageSchemaForCustomSize() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"size": map[string]interface{}{
				"type": "string",
				"enum": []interface{}{"1024x1024", "1792x1024"},
			},
		},
	}
}

func imageSchemaWithDimensionEnums() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"size": map[string]interface{}{
				"type": "string",
				"enum": []interface{}{"1024x1024", "1792x1024"},
			},
			"width": map[string]interface{}{
				"type": "integer",
				"enum": []interface{}{1024, 1792},
			},
			"height": map[string]interface{}{
				"type": "integer",
				"enum": []interface{}{1024, 1024},
			},
		},
	}
}

func TestValidateImageTaskParamsAcceptsCustomWidthAndHeight(t *testing.T) {
	model := &ModelFull{ModelDTO: ModelDTO{InputSchema: imageSchemaForCustomSize()}}
	params := map[string]interface{}{
		"width":  float64(1600),
		"height": float64(900),
	}

	if err := validateImageTaskParams(model, params); err != nil {
		t.Fatalf("custom dimensions rejected: %v", err)
	}
	if params["size"] != "1600x900" {
		t.Fatalf("size = %#v, want canonical 1600x900", params["size"])
	}
	if params["custom_width"] != 1600 || params["custom_height"] != 900 {
		t.Fatalf("custom aliases not canonicalized: %#v", params)
	}
}

func TestValidateImageTaskParamsRejectsInvalidCustomDimensions(t *testing.T) {
	model := &ModelFull{ModelDTO: ModelDTO{InputSchema: imageSchemaForCustomSize()}}
	tests := []struct {
		name    string
		params  map[string]interface{}
		message string
	}{
		{
			name:    "missing height",
			params:  map[string]interface{}{"width": float64(1024)},
			message: "同时提供",
		},
		{
			name:    "fractional width",
			params:  map[string]interface{}{"width": 1024.5, "height": float64(768)},
			message: "整数",
		},
		{
			name:    "too many pixels",
			params:  map[string]interface{}{"width": float64(4096), "height": float64(4096)},
			message: "1600 万",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateImageTaskParams(model, tt.params)
			if err == nil || !strings.Contains(err.Error(), tt.message) {
				t.Fatalf("error = %v, want containing %q", err, tt.message)
			}
		})
	}
}

func TestValidateImageTaskParamsAcceptsNonStandardSizeString(t *testing.T) {
	model := &ModelFull{ModelDTO: ModelDTO{InputSchema: imageSchemaForCustomSize()}}
	params := map[string]interface{}{"size": "1000x800"}

	if err := validateImageTaskParams(model, params); err != nil {
		t.Fatalf("custom size string rejected: %v", err)
	}
	if params["width"] != 1000 || params["height"] != 800 {
		t.Fatalf("dimensions not derived from size: %#v", params)
	}
}

func TestValidateImageTaskParamsAcceptsCustomDimensionsWithDimensionEnums(t *testing.T) {
	model := &ModelFull{ModelDTO: ModelDTO{InputSchema: imageSchemaWithDimensionEnums()}}
	params := map[string]interface{}{"width": float64(1600), "height": float64(900)}

	if err := validateImageTaskParams(model, params); err != nil {
		t.Fatalf("custom dimensions rejected by width/height enums: %v", err)
	}
}

func TestValidateImageTaskParamsDoesNotTreatPresetSizeAsCustom(t *testing.T) {
	model := &ModelFull{ModelDTO: ModelDTO{InputSchema: imageSchemaForCustomSize()}}
	params := map[string]interface{}{"size": "1024x1024"}

	if err := validateImageTaskParams(model, params); err != nil {
		t.Fatalf("preset size rejected: %v", err)
	}
	if _, ok := params["width"]; ok {
		t.Fatalf("preset size unexpectedly gained custom width: %#v", params)
	}
	if _, ok := params["height"]; ok {
		t.Fatalf("preset size unexpectedly gained custom height: %#v", params)
	}
}

func TestValidateSchemaParamsStillRejectsCustomVideoSize(t *testing.T) {
	schema := imageSchemaForCustomSize()
	if err := validateSchemaParams(schema, map[string]interface{}{"size": "1000x800"}); err == nil {
		t.Fatal("generic schema validation unexpectedly accepted non-enum size")
	}
}
