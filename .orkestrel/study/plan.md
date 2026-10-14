# Study implementation

Build the portable Study package and prove it through Agent's authored studies. The public runtime lives in src/core, src/server and src/bin. Consumers retain inputs in studies and outputs in tmp/studies. No publication is authorized.

The user corrected documentation layout on 2026-10-14: guides contains the single study.md package guide, its index and dependency package mirrors. Separate concept guides are being consolidated. Temporary campaign records belong here and are removed at acceptance after their evidence is retained in git history or tests.

Implementation is at6261fbe with source semantics frozen for independent Astra and Opus audits. Agent consumer extraction and removal of duplicated app code are at8a14ac9. Local Agent installation uses file:../study with a copied package, not a symlink. Final rebuild/installed proof, audit reconciliation and independent treewide verification remain.

The separate frozen capacity series runs from Agent's retained instruments. Do not alter its source, build, manifests, dependencies, raw results or daemon. No GPU work is part of package verification.
