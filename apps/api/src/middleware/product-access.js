import { resolveWorkspace } from './resolve-workspace.js';
import { assertCapability } from '../services/workspace-rbac.js';

/** Attach workspace context (role, subscription, settings) after pocketbaseAuth. */
export const attachWorkspace = resolveWorkspace;

/** Require workspace.read — blocks suspended workspaces and anonymous viewers on product APIs. */
export function requireWorkspaceRead(req, res, next) {
	try {
		assertCapability(req, 'workspace.read');
		return next();
	} catch (error) {
		return next(error);
	}
}

export function requireWorkspaceCapability(capability) {
	return (req, res, next) => {
		try {
			assertCapability(req, capability);
			return next();
		} catch (error) {
			return next(error);
		}
	};
}
