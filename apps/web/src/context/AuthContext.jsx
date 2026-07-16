import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import pb from '@/lib/pocketbaseClient';
import { buildOAuthCreateData, openOAuthWindow } from '@/lib/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
	const [user, setUser] = useState(pb.authStore.record);
	const [externalAuths, setExternalAuths] = useState([]);
	const [authMethods, setAuthMethods] = useState(null);

	const syncExternalAuths = useCallback(async (record = pb.authStore.record) => {
		if (!record?.id) {
			setExternalAuths([]);
			return [];
		}

		try {
			const linked = await pb.collection('users').listExternalAuths(record.id);
			setExternalAuths(Array.isArray(linked)
				? linked.map((item) => ({
					...item,
					provider: item?.provider || item?.name || item?.providerName || '',
				}))
				: []);
			return linked;
		} catch (_) {
			setExternalAuths([]);
			return [];
		}
	}, []);

	useEffect(() => {
		const unsub = pb.authStore.onChange((_t, record) => setUser(record));
		return unsub;
	}, []);

	useEffect(() => {
		pb.collection('users').listAuthMethods()
			.then((methods) => setAuthMethods(methods))
			.catch(() => setAuthMethods(null));
	}, []);

	useEffect(() => {
		syncExternalAuths(user);
	}, [syncExternalAuths, user?.id]);

	const login = useCallback(
		(email, password) => pb.collection('users').authWithPassword(email, password),
		[],
	);

	const signup = useCallback(async (name, email, password) => {
		await pb.collection('users').create({
			name,
			email,
			password,
			passwordConfirm: password,
			plan: 'free',
			role: 'member',
		});
		await pb.collection('users').authWithPassword(email, password);
		try {
			await pb.collection('users').requestVerification(email);
		} catch (_) {
			/* ignore */
		}
	}, []);

	const loginWithOAuth = useCallback(async (provider, popupWindow = null) => {
		const authData = await pb.collection('users').authWithOAuth2({
			provider,
			createData: buildOAuthCreateData(pb.authStore.record),
			urlCallback: (url) => {
				if (popupWindow && !popupWindow.closed) {
					popupWindow.location.href = url;
					popupWindow.focus();
					return;
				}
				openOAuthWindow(url);
			},
		});
		setUser(authData?.record || pb.authStore.record);
		await syncExternalAuths(authData?.record || pb.authStore.record);
		return authData;
	}, [syncExternalAuths]);

	const connectProvider = useCallback(async (provider, popupWindow = null) => loginWithOAuth(provider, popupWindow), [loginWithOAuth]);

	const disconnectProvider = useCallback(async (provider) => {
		if (!user?.id) {
			return;
		}

		await pb.collection('users').unlinkExternalAuth(user.id, provider);
		await syncExternalAuths(user);
	}, [syncExternalAuths, user]);

	const logout = useCallback(() => pb.authStore.clear(), []);

	const refresh = useCallback(async () => {
		try {
			await pb.collection('users').authRefresh();
			await syncExternalAuths(pb.authStore.record);
		} catch (_) {
			/* ignore */
		}
	}, [syncExternalAuths]);

	return (
		<AuthContext.Provider
			value={{
				user,
				isAuthed: pb.authStore.isValid,
				login,
				signup,
				logout,
				refresh,
				loginWithOAuth,
				connectProvider,
				disconnectProvider,
				externalAuths,
				authMethods,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}
