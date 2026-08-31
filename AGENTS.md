# Repository Codex Instructions

- Before pushing Compose changes, render the exact overlays with every referenced profile and, when a Docker engine is available, run the production image build plus secret-file startup under the configured unprivileged users; configuration rendering alone does not validate build context or bind-mounted secret readability.
