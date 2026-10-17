-- El feed de AliExpress no informa del stock: se guarda «sin dato» (nulo) en lugar de inventar un número.
alter table public."CatalogItem" alter column stock drop not null;
