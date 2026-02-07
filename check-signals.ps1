$headers = @{
    'apikey' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdhd3BybXd5cG1penR0aWpldHVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTYyMDcsImV4cCI6MjA4NTk5MjIwN30.3CQJb9WCxuuwGvgS41EEkHoYFG_npueNGZp4uoyqwyc'
}

$response = Invoke-RestMethod -Uri 'https://gawprmwypmizttijetue.supabase.co/rest/v1/signals?status=eq.active&select=id,symbol,status,entry_price&limit=10' -Headers $headers
$response | ConvertTo-Json -Depth 5
