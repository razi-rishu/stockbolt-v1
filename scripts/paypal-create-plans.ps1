# ══════════════════════════════════════════════════════════════════════════
# StockBolt — create the PayPal product + 3 subscription plans (SaaS M3)
# ──────────────────────────────────────────────────────────────────────────
# Run from PowerShell:   .\scripts\paypal-create-plans.ps1          (sandbox)
#                        .\scripts\paypal-create-plans.ps1 -Live    (live)
# It asks for your Client ID + Secret (typed locally, never stored), creates
#   StockBolt Professional  → Monthly $21 / 6-Months $105 / Yearly $200 (USD)
# and prints the three plan IDs + the exact SQL to paste into Supabase.
# Safe to re-run: it creates NEW plans each time — only run once per mode.
# ══════════════════════════════════════════════════════════════════════════
param([switch]$Live)

$base = if ($Live) { 'https://api-m.paypal.com' } else { 'https://api-m.sandbox.paypal.com' }
$mode = if ($Live) { 'LIVE' } else { 'SANDBOX' }
Write-Host "Mode: $mode  ($base)" -ForegroundColor Cyan

$clientId = Read-Host "Paste your $mode Client ID"
$secret   = Read-Host "Paste your $mode Secret"

# ── 1. OAuth token ─────────────────────────────────────────────────────────
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${clientId}:${secret}"))
try {
  $tok = Invoke-RestMethod -Method Post -Uri "$base/v1/oauth2/token" `
    -Headers @{ Authorization = "Basic $basic" } `
    -ContentType 'application/x-www-form-urlencoded' `
    -Body 'grant_type=client_credentials'
} catch {
  Write-Host "✗ Could not get a token — check the Client ID/Secret (and that they are $mode keys)." -ForegroundColor Red
  exit 1
}
$H = @{ Authorization = "Bearer $($tok.access_token)" }
Write-Host "✓ Authenticated" -ForegroundColor Green

# ── 2. Product ─────────────────────────────────────────────────────────────
$product = Invoke-RestMethod -Method Post -Uri "$base/v1/catalogs/products" -Headers $H `
  -ContentType 'application/json' -Body (@{
    name        = 'StockBolt Professional'
    description = 'StockBolt ERP subscription'
    type        = 'SERVICE'
    category    = 'SOFTWARE'
  } | ConvertTo-Json)
Write-Host "✓ Product created: $($product.id)" -ForegroundColor Green

# ── 3. Three plans ─────────────────────────────────────────────────────────
function New-Plan([string]$name, [int]$months, [string]$price) {
  $body = @{
    product_id     = $product.id
    name           = $name
    billing_cycles = @(@{
      frequency      = @{ interval_unit = 'MONTH'; interval_count = $months }
      tenure_type    = 'REGULAR'
      sequence       = 1
      total_cycles   = 0     # renews until cancelled
      pricing_scheme = @{ fixed_price = @{ value = $price; currency_code = 'USD' } }
    })
    payment_preferences = @{
      auto_bill_outstanding     = $true
      payment_failure_threshold = 3
    }
  } | ConvertTo-Json -Depth 8
  $plan = Invoke-RestMethod -Method Post -Uri "$base/v1/billing/plans" -Headers $H `
    -ContentType 'application/json' -Body $body
  Write-Host "✓ $name → $($plan.id)" -ForegroundColor Green
  return $plan.id
}

$monthly = New-Plan 'StockBolt Monthly'  1  '21.00'
$half    = New-Plan 'StockBolt 6 Months' 6  '105.00'
$yearly  = New-Plan 'StockBolt Yearly'   12 '200.00'

# ── 4. The SQL for Supabase ────────────────────────────────────────────────
Write-Host ""
Write-Host "Paste this into the Supabase SQL Editor and run it:" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------------"
@"
UPDATE public.subscription_plans
SET provider_plan_ids = jsonb_build_object('paypal', jsonb_build_object(
      'monthly',     '$monthly',
      'half_yearly', '$half',
      'yearly',      '$yearly')),
    updated_at = now()
WHERE code = 'professional';
"@ | Write-Host
Write-Host "----------------------------------------------------------------"
Write-Host "Done. Next: Vercel env vars + webhook (PayPal_Setup_Steps.md steps 4-5)." -ForegroundColor Cyan
