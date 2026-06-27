CREATE OR REPLACE FUNCTION public.ensure_beta_user_free_credits(target_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_user_id uuid;
  granted_row public.credit_grants%ROWTYPE;
BEGIN
  IF target_email IS NULL OR btrim(target_email) = '' THEN
    RETURN;
  END IF;

  SELECT id
  INTO target_user_id
  FROM auth.users
  WHERE lower(email) = lower(target_email)
  ORDER BY created_at DESC
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.credit_grants (
    user_id,
    source_type,
    source_ref,
    plan,
    amount_usd,
    total_credits,
    remaining_credits,
    metadata
  )
  VALUES (
    target_user_id,
    'promo',
    'beta_free_credits_v1',
    'beta',
    10,
    330,
    330,
    jsonb_build_object(
      'reason', 'beta program free credits',
      'program', 'beta',
      'version', 1,
      'email', lower(target_email)
    )
  )
  ON CONFLICT (user_id, source_type, source_ref)
  DO UPDATE
  SET
    plan = EXCLUDED.plan,
    amount_usd = EXCLUDED.amount_usd,
    total_credits = EXCLUDED.total_credits,
    remaining_credits = GREATEST(
      0,
      EXCLUDED.total_credits - GREATEST(0, public.credit_grants.total_credits - public.credit_grants.remaining_credits)
    ),
    metadata = EXCLUDED.metadata,
    updated_at = now()
  RETURNING * INTO granted_row;

  INSERT INTO public.credit_transactions (
    user_id,
    grant_id,
    entry_type,
    source_type,
    source_ref,
    credits,
    amount_usd,
    metadata
  )
  VALUES (
    target_user_id,
    granted_row.id,
    'grant',
    'promo',
    'beta_free_credits_v1',
    330,
    10,
    jsonb_build_object(
      'reason', 'beta program free credits',
      'program', 'beta',
      'version', 1,
      'email', lower(target_email)
    )
  )
  ON CONFLICT (user_id, grant_id, entry_type, source_type, source_ref)
  DO UPDATE
  SET
    credits = EXCLUDED.credits,
    amount_usd = EXCLUDED.amount_usd,
    metadata = EXCLUDED.metadata;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_beta_user_free_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.ensure_beta_user_free_credits(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_beta_users_free_credits ON public.beta_users;
CREATE TRIGGER trg_beta_users_free_credits
  AFTER INSERT OR UPDATE OF email, access_level ON public.beta_users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_beta_user_free_credits();

DO $$
DECLARE
  beta_row record;
BEGIN
  FOR beta_row IN
    SELECT email
    FROM public.beta_users
  LOOP
    PERFORM public.ensure_beta_user_free_credits(beta_row.email);
  END LOOP;
END;
$$;
