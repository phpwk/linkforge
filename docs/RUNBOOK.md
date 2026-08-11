# LinkForge — Operations Runbook

Written for whoever is on the other end of an alert at 2am, or setting this
up on a cluster for the first time. Nothing in here has been exercised
against a live cluster (see README "Known limitations") — treat the exact
commands as correct-as-written, not as battle-tested.

## First-time setup

1. Prerequisites on the target cluster: an Ingress controller (manifests
   assume `ingressClassName: nginx`), cert-manager if you want the TLS
   annotations to do anything, kube-prometheus-stack if you want the
   `ServiceMonitor`/`PrometheusRule` picked up automatically.
2. Replace the placeholder `Secret` in `deploy/k8s/base/postgres.yaml`
   (search for `CHANGE_ME`) — via Sealed Secrets, External Secrets
   Operator, or at minimum a manually-applied real `Secret` that isn't
   committed to git.
3. Install ArgoCD, then:
   ```sh
   kubectl apply -f deploy/argocd/application-dev.yaml
   kubectl apply -f deploy/argocd/application-prod.yaml
   ```
4. Dev starts reconciling immediately (`automated` sync). Prod needs an
   explicit first sync:
   ```sh
   argocd app sync linkforge-prod
   ```

## Releasing a change

- **To dev:** merge to `main`. `cd.yml` builds+pushes images tagged
  `sha-<commit>`, updates `deploy/k8s/overlays/dev/kustomization.yaml`'s
  image tags, and commits that change back to `main` (with `[skip ci]`).
  ArgoCD picks it up within its poll interval (default 3 min) or
  immediately if webhook-notified.
- **To prod:** tag a release — `git tag v1.2.0 && git push --tags`. This
  builds+pushes images tagged `v1.2.0`, updates
  `deploy/k8s/overlays/prod/kustomization.yaml`, and commits that back.
  Nothing deploys yet. Someone runs `argocd app sync linkforge-prod` (or
  clicks Sync in the UI) when ready.

## Rolling back

This is GitOps — a rollback is a git operation, not a `kubectl` one.

1. Find the last-known-good commit on the affected overlay path.
2. `git revert` the offending commit (don't force-push over history — the
   CD pipeline's own commits are part of that history).
3. Dev: ArgoCD self-heals to the reverted state automatically. Prod:
   `argocd app sync linkforge-prod` after the revert lands.

If ArgoCD itself is unreachable, `kubectl rollout undo
deployment/backend -n linkforge` (or `frontend`) is the manual escape
hatch — it will drift from git until the next sync, which is expected and
fine in an emergency.

## Alert response

Straight from `deploy/k8s/base/prometheusrule.yaml`:

| Alert | Meaning | First steps |
|---|---|---|
| `LinkForgeHighErrorRate` | >5% of requests 5xx over 5m | Check backend logs for the actual error; check `/readyz` — is the database reachable? Check recent deploys — did an image tag change right before this fired? |
| `LinkForgeHighLatency` | p99 > 1s over 10m | Check `linkforge_http_request_duration_seconds` by route in Grafana to isolate which endpoint is slow. Most likely cause given the current design: Postgres connection pool exhaustion — see HLD §7 on the 80-connection ceiling at max HPA scale. |
| `LinkForgeBackendDown` | Prometheus has lost all backend scrape targets for 2m | Check pod status (`kubectl get pods -n linkforge -l app.kubernetes.io/name=backend`). Likely a bad rollout — check the most recent image tag against what's actually running. |
| `LinkForgePodCrashLooping` | Any linkforge pod restarted >3x in 15m | `kubectl logs <pod> -n linkforge --previous` for the crash reason. Check `/readyz` dependency chain first — a backend that can't reach Postgres will fail its readiness probe repeatedly but shouldn't be *crashing*; a crash points at an unhandled exception, not a dependency issue. |

## Scaling

- Backend autoscales 2–8 replicas on 70% CPU utilization (HPA). To
  override temporarily: `kubectl scale deployment/backend -n linkforge
  --replicas=N` — the HPA will fight this back toward its computed target
  on its next reconcile, so this is a stopgap, not a fix.
- Frontend does not autoscale (static, cheap to serve — 2 replicas is
  fixed in both overlays). If frontend CPU/memory becomes a real
  bottleneck, that's a signal to add an HPA here too, not a config that
  exists today.
- Postgres does not scale horizontally at all (ADR-005). The only lever is
  vertical (bigger node, bigger PVC) or migrating to a managed
  database/operator.

## Database access

```sh
kubectl exec -it postgres-0 -n linkforge -- psql -U linkforge -d linkforge
```

Migrations are a single file (`db/migrations/001_init.sql`), applied
manually — there is no migration runner/tool wired up. For a second
migration, apply it by hand against the running database and add the file
to `db/migrations/` for the historical record; this repo doesn't yet have
an automated migration step in the deploy pipeline.

## Secret rotation

The current `Secret` is a placeholder (ADR context in `postgres.yaml`).
Once replaced with a real secrets-management setup (External Secrets
Operator or Sealed Secrets), rotation follows whatever that tool's normal
rotation procedure is — nothing LinkForge-specific to do beyond restarting
the backend and postgres pods to pick up the new value, since neither
watches the Secret for live changes.
