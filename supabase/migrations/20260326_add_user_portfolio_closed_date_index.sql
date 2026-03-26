create index if not exists idx_user_portfolio_user_closed_date
  on user_portfolio (user_id, close_date desc)
  where is_closed = true;
