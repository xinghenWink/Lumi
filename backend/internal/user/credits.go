package user

import "context"

func (s *Service) addBalance(ctx context.Context, profile *Profile) error {
	permanent, daily, err := s.credits.Summary(ctx, profile.ID)
	if err != nil {
		return err
	}
	total := permanent + daily
	profile.PermanentBalance = &permanent
	profile.DailyBalance = &daily
	profile.TotalCredits = &total
	return nil
}
