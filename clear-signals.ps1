$headers = @{
    'apikey' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdhd3BybXd5cG1penR0aWpldHVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTYyMDcsImV4cCI6MjA4NTk5MjIwN30.3CQJb9WCxuuwGvgS41EEkHoYFG_npueNGZp4uoyqwyc'
    'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdhd3BybXd5cG1penR0aWpldHVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTYyMDcsImV4cCI6MjA4NTk5MjIwN30.3CQJb9WCxuuwGvgS41EEkHoYFG_npueNGZp4uoyqwyc'
    'Content-Type' = 'application/json'
    'Prefer' = 'return=minimal'
}

# Delete all signals (use not.is.null on id)
Write-Host "Deleting all signals..."
Invoke-RestMethod -Method Delete -Uri 'https://gawprmwypmizttijetue.supabase.co/rest/v1/signals?id=not.is.null' -Headers $headers

# Delete all processed signals
Write-Host "Deleting processed signals cache..."
Invoke-RestMethod -Method Delete -Uri 'https://gawprmwypmizttijetue.supabase.co/rest/v1/processed_signals?id=not.is.null' -Headers $headers

Write-Host "Done! All signals cleared."
