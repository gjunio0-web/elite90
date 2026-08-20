# Notes for Claude working in this repo

## Sending files to the user

When a file is sent via SendUserFile and the user needs to save it at a
specific path/filename in their local project (e.g. a new script under
`scripts/`), always state that exact destination path and filename in the
caption. Don't rely on the download preserving the original filename or
extension — it may not (and Windows hides known extensions by default,
which can mask a silently truncated one).
