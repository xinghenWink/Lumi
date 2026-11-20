package images

import "testing"

func TestOutputFormat(t *testing.T) {
	for _, tc := range []struct {
		name, prompt, explicit, want string
		supported, infer, wantError  bool
	}{
		{name: "reference edit prompt", prompt: "使用参考图的角色，生成角色自拍比耶的GIF动图", supported: true, infer: true, want: "gif"},
		{name: "English prompt", prompt: "Create a GIF of a cat waving.", supported: true, infer: true, want: "gif"},
		{name: "explicit GIF", prompt: "A cat waving", explicit: "gif", supported: true, want: "gif"},
		{name: "static override", prompt: "Create a GIF of a cat waving.", explicit: "png", supported: true, infer: true, want: "png"},
		{name: "poster lettering", prompt: "生成一张带有 GIF 字样的海报", supported: true, infer: true},
		{name: "quoted phrase", prompt: "Show \"create a GIF of a cat\" on a poster", supported: true, infer: true},
		{name: "negation", prompt: "不要生成 GIF 动图", supported: true, infer: true},
		{name: "English negation", prompt: "Don't create a GIF.", supported: true, infer: true},
		{name: "legacy route", prompt: "Create a GIF of a cat waving.", infer: true},
		{name: "canvas", prompt: "Create a GIF of a cat waving.", supported: true},
		{name: "undeclared capability", explicit: "gif", wantError: true},
		{name: "invalid format", explicit: "webp", supported: true, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveOutputFormat(Input{Prompt: tc.prompt, OutputFormat: tc.explicit}, tc.supported, tc.infer)
			if got != tc.want || (err != nil) != tc.wantError {
				t.Fatalf("output=%q, error=%v; want %q, error=%t", got, err, tc.want, tc.wantError)
			}
		})
	}
	if _, err := resolveOutputFormat(Input{OutputFormat: "gif", EditOptions: &EditOptions{Action: editRemoveBackground}}, true, true); err == nil {
		t.Fatal("specialized editor accepted GIF output")
	}
}
