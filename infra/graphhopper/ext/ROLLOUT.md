# Future graph rollout and rollback

## Future rollout — do not execute as part of this task

The candidate remains unpromoted. Require review of the final benchmark,
residential/busy exposure and surface changes, corpus recall/detour regret,
closure/access evidence and blinded rider preference before authorizing rollout.
A successful import or test suite alone does not authorize promotion.

1. **Identify and snapshot the actual live owner at deployment time.** On the
   serving host (expected docker-stable; the task identifies its graph as
   `/root/Vibe/switchback/data/graph-cache`), inspect the running GH container's
   immutable image, command, mounts, config/model source paths, restart policy
   and listen/proxy path. Do not substitute megaplex or a similarly named graph.
   Repository topology notes are older and must not override runtime mounts.
   This task deliberately did not contact that live router, so no container ID
   or unverified service name is invented here.

   A read-only discovery command for the future operator is:

   ```sh
   docker inspect $(docker ps -q) > /tmp/og-curve-live-containers.json
   python3 - <<'PY'
   import json
   expected='/root/Vibe/switchback/data/graph-cache'
   hits=[]
   for c in json.load(open('/tmp/og-curve-live-containers.json')):
       for m in c.get('Mounts',[]):
           src=m['Source'].rstrip('/')
           if expected==src or expected.startswith(src+'/'):
               hits.append((c['Id'],c['Name'],c['Image'],c['Config']['Cmd'],c['Mounts']))
               break
   assert len(hits)==1, 'Resolve the actual GH owner before any mutation'
   print(hits[0])
   PY
   ```

   Save `docker inspect`, exact jar/image digest, `/info`, working configuration,
   all model hashes, graph hashes and app release/policy/graph IDs in one dated
   rollback record. Verify current mounted model bytes against the control
   baseline; abort on drift until it is reviewed.

2. **Stage a matched candidate unit beside the live graph.** Stop the isolated
   powerplex candidate before archiving its graph. Stream the graph, exact
   runtime jar, extension jar, source/manifest hashes, models and config over
   SSH/tar (do not use Windows scp for large assets). Extract to a new staging
   directory on the serving graph filesystem, e.g.
   `/root/Vibe/switchback/data/og-curve-candidate-<artifact-id>`.
   Verify every SHA-256 after transfer. Do not copy into `graph-cache` yet.
   Retain the original PA/NJ PBF and pre-pass provenance separately; import is
   never run on the eight-GiB docker-dev host.

3. **Run a local canary with the matching jar/graph/models/config on free ports.**
   Adapt only the staged config's graph/model paths and listen ports. Do not
   reuse old landmark files. Verify health, `/info.encoded_values.og_curve`,
   LM/flexible weights, fixed requests through the app adapter and full relevant
   routing/access checks. The PA/NJ candidate prepares LM; the tiny persisted
   fixture also proves CH/flexible weight equivalence. A regional CH deployment
   would need its own preparation and checks.

4. **Swap the graph/config/models as one unit during an authorized stop.** Bind
   `router_id` to the unique ID discovered above, `graph` to the verified mounted
   graph source, and `config`/`models` to the verified mounted host paths.
   Make a byte-preserving backup of config and the entire model directory first.
   Prepare a reviewed live config that retains its current ports, binds, paths,
   access and profile settings, adding `og_curve` to encoded values; the graph
   and baked model hashes must match the candidate. Do not install the
   experiment's `:8991` config verbatim.

   With the canary stopped and all variables reviewed, the atomic filesystem
   operations are:

   ```sh
   # FUTURE AUTHORIZED DEPLOYMENT ONLY. Same filesystem; no graph deletion.
   docker stop "$router_id"
   mv "$graph" "$graph-rollback-$artifact_id"
   mv "$staged_graph" "$graph"
   # Install the already staged matching config and model directory at the
   # previously verified mount sources; keep their exact old copies for rollback.
   cp -a "$staged_config" "$config"
   mv "$models" "$models-rollback-$artifact_id"
   mv "$staged_models" "$models"
   docker start "$router_id"
   ```

   The candidate was built for the exact GH 11 jar recorded in provenance. If
   the current container runs a different jar/image, stage and qualify a matching
   runtime container before this step and retain the old container/image for
   rollback. Do not silently combine an unqualified runtime with the new graph.
   Promote under a reviewed new **code-owned policy version** and
   `OGV_GRAPH_VERSION` via the normal app release process; the obsolete
   `OGV_POLICY_VERSION` environment override is not a policy release.

5. **Verify after the swap.** Check health and public app/router provenance,
   `og_curve` availability, exact graph/model/runtime hashes, the six-trip ×
   two-style × two-graph benchmark (24 cases total), LM constraints and the requested planning path from
   a fresh app session. Keep closure/access and physical/on-road acceptance
   separate. Restore immediately on failed health, fingerprint, eligibility or
   route-quality gates. From the qualified app checkout, compare the preserved
   control against the promoted router using their verified URLs (future step;
   not executed by this experiment):

   ```sh
   OGV_CURVE_BENCHMARK=1 \
   OGV_CURVE_CONTROL_URL="$qualified_control_url" \
   OGV_CURVE_TREATMENT_URL="$promoted_router_url" \
   OGV_CURVE_EVIDENCE="$post_swap_evidence" \
   npm run test:real-router -- tests/real-router/og-curve-benchmark-live.test.ts
   ```

   Expect 24 passing cases and review all 12 paired quality/time deltas, including
   HTTP-attempt parity and unknown-surface exposure; a green test alone is not
   route-quality acceptance.

6. **Rollback without rebuilding.** Stop the newly promoted router/container,
   move the failed graph aside, move `graph-cache-rollback-<artifact-id>` back
   to its exact original mount source, restore the saved config and entire
   model directory, and restart the saved old container/image. For the same
   qualified container:

   ```sh
   docker stop "$router_id"
   mv "$graph" "$graph-failed-$artifact_id"
   mv "$graph-rollback-$artifact_id" "$graph"
   cp -a "$saved_config" "$config"
   mv "$models" "$models-failed-$artifact_id"
   mv "$models-rollback-$artifact_id" "$models"
   docker start "$router_id"
   ```

   Restore the paired app release/policy/graph identity if it was promoted.
   Recheck health, old `/info`/hashes, fixed-route results and the public planning
   path. Retain both graph units until the replacement is accepted; do not
   overwrite, prune or rebuild the rollback graph.
