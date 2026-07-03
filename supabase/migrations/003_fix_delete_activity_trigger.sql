-- Fix: hard delete always failed with a foreign-key error because the
-- activity trigger ran AFTER DELETE and inserted a log row still pointing at
-- the deleted product. Deletes are now logged with product_id = null; the
-- item's full details remain readable in before_data.

create or replace function public.log_product_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action_name text;
begin
  action_name := lower(TG_OP);

  if TG_OP = 'INSERT' then
    insert into public.inventory_activity (product_id, actor_id, action, before_data, after_data)
    values (new.id, auth.uid(), action_name, null, to_jsonb(new));
    return new;
  elsif TG_OP = 'UPDATE' then
    insert into public.inventory_activity (product_id, actor_id, action, before_data, after_data)
    values (new.id, auth.uid(), action_name, to_jsonb(old), to_jsonb(new));
    return new;
  elsif TG_OP = 'DELETE' then
    insert into public.inventory_activity (product_id, actor_id, action, before_data, after_data)
    values (null, auth.uid(), action_name, to_jsonb(old), null);
    return old;
  end if;

  return null;
end;
$$;
