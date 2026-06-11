/**
 * Seeds browser-like globals that linkage modules expect via bridgeGlobals.
 */
import { createTestState } from './helpers/state-fixture.js';

import '../js/linkage/constants.js';
import '../js/linkage/math.js';
import '../js/linkage/geometry-classes.js';
import '../js/linkage/solver.js';
import '../js/linkage/collision.js';

globalThis.state = createTestState();
globalThis.ibcStackLayoutCacheKey = '';
