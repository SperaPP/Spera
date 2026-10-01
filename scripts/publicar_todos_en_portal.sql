-- publicar_todos_en_portal.sql — corrección de datos (one-off).
--
-- Varios productos habían quedado con portal_visible = false por error, y eso los
-- ocultaba del catálogo mayorista aunque pasaran el resto de los filtros. Esto los
-- vuelve a publicar a TODOS: la visibilidad en el portal pasa a depender solo de
-- activo + precio en la lista + stock disponible. El toggle "Publicar en portal"
-- sigue existiendo para ocultar puntualmente a futuro.

-- Cuántos están ocultos hoy (informativo, corré esto primero si querés).
-- select count(*) from public.products where portal_visible is distinct from true;

update public.products
set portal_visible = true
where portal_visible is distinct from true;  -- cubre false y null
