// Reuse the server's full core initialization for desktop spec files that
// touch becca / sql — replicating it would mean dragging the entire provider
// stack over for one test fixture.
import "../../server/spec/setup.js";
