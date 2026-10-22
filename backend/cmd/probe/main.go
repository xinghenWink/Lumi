package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/xinghenWink/Lumi/backend/internal/upstream"
	"github.com/xinghenWink/Lumi/backend/internal/upstream/probe"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	options := probe.Options{BaseURL: os.Getenv("UPSTREAM_BASE_URL"), APIKey: os.Getenv("UPSTREAM_API_KEY")}
	flag.StringVar(&options.ChatModel, "chat-model", "", "Explicit text model for one streaming request")
	flag.StringVar(&options.ImageModel, "image-model", "", "Explicit image model")
	flag.StringVar(&options.ProxyURL, "proxy", "", "Explicit HTTP proxy for the probe")
	flag.StringVar(&options.Prompt, "prompt", "", "Image generation test prompt")
	flag.StringVar(&options.ImageOutput, "image-output", "", "Private image path prefix; the detected extension is appended")
	flag.StringVar(&options.ReferencePath, "reference-file", "", "Explicit PNG reference for edit or vision probing")
	flag.StringVar(&options.Quality, "quality", "low", "One quality value to observe")
	flag.StringVar(&options.Size, "size", "1024x1024", "One size value to observe")
	flag.StringVar(&options.EditFormat, "edit-format", "multipart", "Edit encoding: multipart or json")
	flag.IntVar(&options.Count, "n", 1, "Number of requested images (1-4)")
	flag.BoolVar(&options.Images, "images", false, "Perform one image generation request (may incur upstream charges)")
	flag.BoolVar(&options.Edit, "edit", false, "Perform one edit request (may incur upstream charges)")
	flag.BoolVar(&options.Vision, "vision", false, "Perform one image understanding request")
	options.Policy = upstream.NetworkPolicy{}
	flag.BoolVar(&options.Policy.AllowPrivate, "allow-private", false, "Allow an explicitly trusted self-hosted private network")
	output := flag.String("output", "", "Private JSON report path; stdout when empty")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	report, err := probe.Run(ctx, options)
	if err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode probe report: %w", err)
	}
	encoded = append(encoded, '\n')
	if *output != "" {
		if err := os.WriteFile(*output, encoded, 0o600); err != nil {
			return fmt.Errorf("save private probe report: %w", err)
		}
	} else if _, err := os.Stdout.Write(encoded); err != nil {
		return fmt.Errorf("write probe report: %w", err)
	}
	for _, observation := range report.Observations {
		if observation.Error != "" {
			return fmt.Errorf("probe recorded a failed observation; inspect the redacted report")
		}
	}
	return nil
}
