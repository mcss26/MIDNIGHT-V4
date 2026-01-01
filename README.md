# Midnight SQL - Documentación de Base de Datos

Este repositorio contiene la estructura de la base de datos para el sistema ERP Midnight. A continuación se detallan las tablas organizadas por módulos funcionales.

## Módulo: Core / Perfiles
Gestión de usuarios, roles y proveedores base.
*   **profiles**: Perfiles de usuario vinculados a Auth (id, nombre, role).
*   **staff_roles**: Definición de roles para el personal.
*   **suppliers**: Maestro de proveedores.

## Módulo: Inventario (Inventory)
Gestión de SKUs, stock, movimientos y compras.
*   **inventory_skus**: Maestro de artículos/SKUs.
*   **inventory_stock**: Registro histórico de stock.
*   **inventory_stock_current**: Vista o tabla de stock actual.
*   **inventory_movements**: Registro de entradas y salidas de almacén.
*   **inventory_purchase_requests / lines**: Solicitudes de compra de insumos.
*   **inventory_purchase_receipts / lines**: Recepción de mercadería y facturas de compra.
*   **inventory_check_runs / requests / lines**: Procesos de auditoría y conteo físico de stock.

## Módulo: Finanzas (Finance)
Control de pagos, reglas de facturación y costos.
*   **finance_payments / items**: Registro de pagos realizados y sus conceptos.
*   **finance_payment_rules**: Reglas automáticas para la generación de pagos.
*   **finance_opening_cost_defs / instances**: Definición y ejecución de costos de apertura.
*   **finance_payroll_area_instances**: Gestión de áreas para liquidación de haberes/pagos.
*   **finance_balance_queue**: Cola de procesamiento para balances financieros.

## Módulo: Operación Diaria (Service Day)
Control de la operación por jornada.
*   **service_days**: Apertura y cierre de jornadas operativas.
*   **service_day_staff**: Personal asignado a cada jornada.
*   **service_day_checklist_items**: Ejecución de checklists durante el servicio.
*   **checklist_item_defs**: Definición maestra de ítems de control.

## Módulo: Precios y Recetas (Pricing & Recipes)
Cálculo de costos y márgenes.
*   **pricing_channels**: Canales de venta (ej. salón, delivery).
*   **pricing_params**: Parámetros globales para el cálculo de precios.
*   **pricing_runs**: Historial de corridas de cálculo de precios.
*   **recipe_ingredients**: Composición de productos (SKUs que componen un plato).
*   **menu_items**: Artículos del menú de venta.

## Módulo: Análisis de Datos (Analysis)
Tablas de staging para importación y análisis masivo.
*   **analysis_imports**: Batches de importación de datos externos.
*   **analysis_import_files**: Archivos asociados a cada importación.
*   **analysis_recaudacion_raw**: Datos crudos de recaudación importados.
*   **analysis_consumo_raw**: Datos crudos de consumo importados.
