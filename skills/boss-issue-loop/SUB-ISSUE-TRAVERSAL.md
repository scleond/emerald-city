# Sub-Issue Traversal Reference

Paste-ready `gh api graphql` queries for enumerating a spec issue's native
sub-issue descendants recursively.

## Single-depth query

Enumerates immediate children. Suitable when nested specs are the only
organizational nodes and their own children are tracked independently.

```bash
gh api graphql -f query='
{
  repository(owner: "'"$OWNER"'", name: "'"$REPO"'") {
    issue(number: '"$ISSUE_NUMBER"') {
      title
      state
      subIssues(first: 100) {
        nodes {
          number
          title
          state
          labels(first: 10) { nodes { name } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}'
```

## Recursive query (two-level)

Traverses children and grandchildren. Covers the typical spec → nested-spec →
implementation-ticket tree. For deeper nesting, extend the pattern: each
additional level nests another `subIssues(first: 100)` block inside the prior
level's nodes.

```bash
gh api graphql -f query='
{
  repository(owner: "'"$OWNER"'", name: "'"$REPO"'") {
    issue(number: '"$ISSUE_NUMBER"') {
      title
      state
      subIssues(first: 100) {
        nodes {
          number
          title
          state
          labels(first: 10) { nodes { name } }
          subIssues(first: 100) {
            nodes {
              number
              title
              state
              labels(first: 10) { nodes { name } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}'
```

## Pagination

GitHub returns at most 100 nodes per connection. When `hasNextPage` is true,
paginate with `after: $cursor`:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $issueNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      subIssues(first: 100, after: $cursor) {
        nodes { number title state }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}' -f owner="$OWNER" -f repo="$REPO" -F issueNumber="$ISSUE_NUMBER" -F cursor="$CURSOR"
```

## Expected output shape

```json
{
  "data": {
    "repository": {
      "issue": {
        "title": "Spec: ...",
        "state": "OPEN",
        "subIssues": {
          "nodes": [
            {
              "number": 12,
              "title": "Implement X",
              "state": "OPEN",
              "labels": { "nodes": [{ "name": "generated" }] },
              "subIssues": {
                "nodes": [],
                "pageInfo": { "hasNextPage": false, "endCursor": null }
              }
            }
          ],
          "pageInfo": { "hasNextPage": false, "endCursor": null }
        }
      }
    }
  }
}
```

## Behaviour

- **Native sub-issues only.** Body cross-references (`#N` mentions) are
  not sub-issues. The `subIssues` field is GitHub's dedicated parent → child
  relation, distinct from issue body mentions.
- **Nested spec issues** (label `spec`) are organisational nodes, not
  implementation tickets. The traversal enumerates them, but scope selection
  filters them out of the work list — their children are traversed separately.
- **Zero descendants.** If a spec issue has zero immediate sub-issues, that is
  a distinct condition from "all descendants closed." Report it explicitly:
  `Spec #N has zero discovered implementation descendants — not eligible for
  loop processing.`
- **Verified against** issue #7 in `scleond/emerald-city`: 9 immediate
  children (issues #8–#16), none with their own sub-issues.
