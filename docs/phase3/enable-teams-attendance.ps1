# =============================================================================
# Enable Teams attendance + meeting details for the ATS Pipeline Tracker
# Run by: a Microsoft 365 / Teams administrator, ONCE.
#
# What this does: authorizes the ATS app (app-only) to read online-meeting
# details and attendance reports ON BEHALF OF the recruitment mailbox, so the
# ATS can (1) show the Teams Meeting ID + Passcode in invite emails and (2)
# automatically detect whether an interview actually happened (no-show
# detection) before an interviewer scorecard is ever sent.
#
# Prerequisite (done separately in Entra > App registrations > API permissions,
# then "Grant admin consent"):
#   - Calendars.ReadWrite            (Application)   [already granted]
#   - OnlineMeetings.ReadWrite.All   (Application)   [already granted; superset of Read.All]
#   - OnlineMeetingArtifact.Read.All (Application)   [needed for attendance reports]
#   - User.Read.All (Application) OR use the mailbox GUID as MS_CALENDAR_MAILBOX
#
# Docs: docs/phase3/MS-GRAPH-SETUP-FOR-IT.md
# =============================================================================

# --- Values for THIS tenant (confirmed from the app's 403 during testing) ---
$AppClientId    = "6dc40383-30fc-42e5-8fb1-748e45f81c25"       # ATS app registration (client) id
$RecruitMailbox = "pkmondal@aapnainfotech.com"                 # the mailbox that organizes interview meetings (MS_CALENDAR_MAILBOX)
$PolicyName     = "ATS-Interview-Attendance"

# 1) Connect (an admin sign-in window will open)
Import-Module MicrosoftTeams -ErrorAction Stop
Connect-MicrosoftTeams

# 2) Create the application access policy referencing the ATS app id.
#    (If it already exists, this line errors harmlessly — skip to step 3.)
New-CsApplicationAccessPolicy `
  -Identity $PolicyName `
  -AppIds $AppClientId `
  -Description "ATS reads interview meeting details/attendance on behalf of the recruitment mailbox"

# 3) Grant the policy to the recruitment mailbox (the meeting organizer).
Grant-CsApplicationAccessPolicy `
  -PolicyName $PolicyName `
  -Identity $RecruitMailbox

# 4) Verify the grant took (should list the policy against the mailbox).
Get-CsApplicationAccessPolicy -Identity $PolicyName
Get-CsUserPolicyAssignment -Identity $RecruitMailbox -PolicyType ApplicationAccessPolicy

Write-Host ""
Write-Host "Done. Policy propagation can take up to ~30 minutes." -ForegroundColor Green
Write-Host "After that, the ATS will populate Meeting ID + Passcode and can" -ForegroundColor Green
Write-Host "auto-detect no-shows from Teams attendance. No app restart needed." -ForegroundColor Green

# =============================================================================
# HOW TO CONFIRM IT WORKED (for the developer, after ~30 min):
#   1. In backend/.env keep:  MS_CALENDAR_ENABLED=true   MS_ATTENDANCE_ENABLED=true
#   2. Book a fresh interview from the ATS.
#   3. The invite email should now show Meeting ID + Passcode (not just Join link),
#      and rpa_interview_schedule.teams_meeting_id / teams_passcode will be filled.
#   4. Backend log should NO LONGER show:
#        "No application access policy found for this app 6dc40383-... on the user"
# =============================================================================
