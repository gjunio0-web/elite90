# Notes for Claude working in this repo

## Deploying: quality before production, always

Never push to `main` directly. Work travels branch → `quality_env` →
`main`, in that order, every time — including for one-line fixes, and
including when the change looks too small to be worth the trip.

`main` is what Netlify publishes to the live site, so anything landing
there is already in front of visitors. `quality_env` is the branch deploy
where it gets looked at first. Skipping that step doesn't save time; it
just moves the review to after the audience has seen the result.

Note what a branch deploy can and cannot prove. Anything gated on
`context.deploy.context === "production"` is inert on `quality_env` — the
`/progresso` guard, for one, lets every path through outside production.
So quality confirms the build succeeded, the edge function was bundled,
and the pages render; it says nothing about the gated behavior itself.
When that is the case, say so plainly instead of presenting a branch
deploy as proof of something it never exercised.

## Sending files to the user

When a file is sent via SendUserFile and the user needs to save it at a
specific path/filename in their local project (e.g. a new script under
`scripts/`), always state that exact destination path and filename in the
caption. Don't rely on the download preserving the original filename or
extension — it may not (and Windows hides known extensions by default,
which can mask a silently truncated one).
