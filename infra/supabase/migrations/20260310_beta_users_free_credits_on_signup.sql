CREATE OR REPLACE FUNCTION public.handle_auth_user_beta_free_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.beta_users b
    WHERE lower(b.email) = lower(NEW.email)
  ) THEN
    PERFORM public.ensure_beta_user_free_credits(NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_users_beta_free_credits ON auth.users;
CREATE TRIGGER trg_auth_users_beta_free_credits
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_beta_free_credits();
