-- Arabic round-trip check. Read-only: reports what is stored, and whether any
-- stored value is mojibake rather than Arabic. Run in the SQL Editor.
--
-- Expect every 'arabic_ok' to be true. A false means the value reached the
-- database already corrupted, which is a different fault from a UI that renders
-- correct data wrongly.
select
  'products.name'        as field,
  count(*)                                          as total,
  count(*) filter (where name ~ '[؀-ۿ]')          as has_arabic,
  count(*) filter (where name ~ '[ØÙÚÃÂ]')         as mojibake_suspect,
  count(*) filter (where name ~ '[؀-ۿ]')          as arabic_ok
  from products
union all
select 'customers.name', count(*),
       count(*) filter (where name ~ '[؀-ۿ]'),
       count(*) filter (where name ~ '[ØÙÚÃÂ]'),
       count(*) filter (where name ~ '[؀-ۿ]')
  from customers
union all
select 'sales.notes', count(*),
       count(*) filter (where notes ~ '[؀-ۿ]'),
       count(*) filter (where notes ~ '[ØÙÚÃÂ]'),
       count(*) filter (where notes ~ '[؀-ۿ]')
  from sales
union all
select 'shop_settings.shop_name', count(*),
       count(*) filter (where shop_name ~ '[؀-ۿ]'),
       count(*) filter (where shop_name ~ '[ØÙÚÃÂ]'),
       count(*) filter (where shop_name ~ '[؀-ۿ]')
  from shop_settings
union all
select 'shop_settings.receipt_footer', count(*),
       count(*) filter (where receipt_footer ~ '[؀-ۿ]'),
       count(*) filter (where receipt_footer ~ '[ØÙÚÃÂ]'),
       count(*) filter (where receipt_footer ~ '[؀-ۿ]')
  from shop_settings
order by 1;

-- Any individual value that is mojibake, so it can be identified and fixed.
select 'product' as entity, name as value from products where name ~ '[ØÙÚÃÂ]'
union all
select 'customer', name from customers where name ~ '[ØÙÚÃÂ]'
union all
select 'setting', coalesce(shop_name, receipt_footer) from shop_settings
 where coalesce(shop_name, '') ~ '[ØÙÚÃÂ]' or coalesce(receipt_footer, '') ~ '[ØÙÚÃÂ]';
