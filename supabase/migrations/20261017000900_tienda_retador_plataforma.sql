-- Retador como plataforma de tienda. Va sola porque un valor nuevo de un tipo enumerado
-- no se puede usar en la misma transacción en que se crea.
alter type "StorePlatform" add value if not exists 'RETADOR';
