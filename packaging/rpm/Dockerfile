FROM fedora:44

RUN dnf install -y findutils nodejs rpm-build \
    && dnf clean all

WORKDIR /workspace
ENV AI_STACK_SKIP_BUILD=1
CMD ["./scripts/build-rpm.sh"]
