-- +goose Up
-- Reserve infrastructure separately from business tables introduced in M1.
CREATE SCHEMA IF NOT EXISTS lumi;
