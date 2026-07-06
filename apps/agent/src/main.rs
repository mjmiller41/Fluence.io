//! LaserKerf Agent — native companion bridge (M0 stub).
//!
//! The real Agent (localhost WSS listener, origin-lock, token pairing, signed
//! auto-updater, Ruida/galvo transports) lands in milestone **M4** — see
//! `docs/03-implementation-plan.md` card `M4-T01` and CLAUDE.md invariant 6.
//!
//! For M0 this only has to compile, run, and test green so the monorepo's Rust
//! toolchain and the CI wiring are proven end to end.

/// Agent build/protocol version, negotiated with the web App at pairing time (M4).
pub const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Loopback address the Agent binds its WSS listener to. Security invariant: the
/// Agent is localhost-only and MUST NEVER bind a routable interface (no 0.0.0.0).
pub const LOOPBACK: &str = "127.0.0.1";

/// Human-readable startup banner. Kept in a pure function so it is unit-testable.
fn banner() -> String {
    format!("laserkerf-agent {AGENT_VERSION} (M0 stub) — loopback {LOOPBACK}")
}

fn main() {
    println!("{}", banner());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_binds_loopback_only() {
        let b = banner();
        assert!(
            b.contains(LOOPBACK),
            "banner must name the loopback address"
        );
        assert!(
            !b.contains("0.0.0.0"),
            "Agent must never advertise a routable bind address"
        );
    }

    #[test]
    fn version_is_populated_from_cargo() {
        assert!(!AGENT_VERSION.is_empty(), "CARGO_PKG_VERSION must be set");
    }
}
