# Bot-Assign Microsoft 365 Project Instructions

## Project direction

Bot-Assign is being migrated from Google-based automation to a Microsoft 365-first architecture.

### Preferred platform
1. SharePoint / SharePoint Lists
2. Excel for the web in SharePoint or OneDrive
3. Power Automate
4. Power Apps
5. Microsoft Teams
6. Microsoft Graph / Entra ID
7. Custom web/API services only when necessary

### Legacy platform
The existing Google Apps Script files are reference implementations of business logic. Do not extend Google infrastructure unless explicitly requested for migration compatibility.

## Core business requirement

The system processes daily Passenger Services (PSA) and Lost & Found/Baggage Services (LL) rosters and generates manpower and timetable reporting.

Accuracy of manpower and attendance classifications is more important than implementation convenience.

## Operational timezone

Use Asia/Bangkok for dates, schedules, and daily processing.

## Security

Never commit secrets, credentials, access tokens, webhook URLs containing secrets, employee sensitive information, or production connection strings.

## Change discipline

Before changing parsing/classification behavior, inspect FINDINGS.md and the relevant reader implementation. If behavior changes, document the reason and expected impact.

## Testing

Whenever possible, validate migrated functionality against the same roster input used by the legacy implementation and compare:
- totals
- team counts
- position counts
- attendance status
- OT
- flights
- timetable assignments
- PSA/LL combined totals

## Migration principle

Preserve business behavior first. Replace infrastructure second. Improve/refactor only when the change is safe, testable, and clearly documented.
