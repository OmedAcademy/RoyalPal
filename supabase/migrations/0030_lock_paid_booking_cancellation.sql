-- A participant can no longer cancel a PAID lesson with a direct write.
--
-- Closes H5's attack surface (phase2 A9/B6) WITHOUT deciding the refund
-- policy. Until now enforce_booking_status_transition (0006) let the student
-- or the tutor move a 'confirmed' booking straight to 'cancelled'. 'confirmed'
-- is only ever reached through the payment webhook, so every such booking has
-- money behind it: the lesson vanished, the charge stayed, the transfer to the
-- tutor stayed, and nothing in the system recorded that a decision about that
-- money had been skipped.
--
-- This does NOT answer who gets refunded, on what notice, or who absorbs the
-- platform fee. It only removes the path that answers it by accident. Once the
-- policy exists it belongs in cancelBooking, which from this migration onward
-- is the only way a paid lesson can be cancelled — that action runs the write
-- through the service role and can issue the refund in the same breath.
--
-- What is still permitted, and why:
--   * pending_payment -> cancelled by the student: no money has moved, so
--     there is nothing to decide. Refused anyway if a succeeded payment
--     exists, which is the webhook-lag race — the student has paid and the
--     booking has not caught up. That window is exactly when cancelling
--     without a refund is most attractive and least visible.
--   * confirmed -> cancelled by an admin or the service role: unchanged.
--     Admins cancel deliberately, and the service role is the server's own
--     code (cancelBooking, the expiry sweep, the webhook).
--
-- SECURITY DEFINER is inherited from 0006 and is what lets the payments
-- lookup below read a row the cancelling client cannot see for itself.
--
-- Apply only once the service-role write in cancelBooking is the deployed
-- code, or cancelling a paid lesson fails for every student and tutor.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_system boolean := public.is_admin() or auth.role() = 'service_role';
  is_paid boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'pending_payment' and new.status = 'confirmed' then
    if auth.role() <> 'service_role' and not public.is_admin() then
      raise exception 'only the payment webhook or an admin can confirm a booking';
    end if;

  elsif new.status = 'cancelled' and old.status in ('pending_payment', 'confirmed') then
    if not (
      auth.uid() = old.student_id
      or (old.status = 'confirmed' and auth.uid() = old.tutor_id)
      or is_system
    ) then
      raise exception 'not permitted to cancel this booking';
    end if;

    -- The money check, applied to participants only. 'confirmed' means the
    -- payment webhook ran; the payments lookup additionally catches a booking
    -- that has been paid for but not yet confirmed.
    if not is_system then
      select old.status = 'confirmed'
             or exists (
               select 1 from public.payments p
               where p.booking_id = old.id and p.status = 'succeeded'
             )
        into is_paid;

      if is_paid then
        raise exception 'a paid lesson cannot be cancelled directly; cancel it through the app so the refund is decided'
          using errcode = '42501';
      end if;
    end if;

  elsif old.status = 'confirmed' and new.status = 'completed' then
    if not (public.is_admin() or auth.role() = 'service_role') then
      raise exception 'only an admin or the system can mark a booking completed';
    end if;

  elsif old.status in ('confirmed', 'completed') and new.status = 'refunded' then
    if not (public.is_admin() or auth.role() = 'service_role') then
      raise exception 'only an admin or the system can refund a booking';
    end if;

  else
    raise exception 'invalid booking status transition from % to %', old.status, new.status;
  end if;

  return new;
end;
$$;
