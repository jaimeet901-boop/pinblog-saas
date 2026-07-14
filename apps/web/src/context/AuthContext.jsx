import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import pb from '@/lib/pocketbaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
	const [user, setUser] = useState(pb.authStore.record);

	useEffect(() => {
		const unsub = pb.authStore.onChange((_t, record) => setUser(record));
		return unsub;
	}, []);

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

	const logout = useCallback(() => pb.authStore.clear(), []);

	const refresh = useCallback(async () => {
		try {
			await pb.collection('users').authRefresh();
		} catch (_) {
			/* ignore */
		}
	}, []);

	return (
		<AuthContext.Provider
			value={{ user, isAuthed: pb.authStore.isValid, login, signup, logout, refresh }}
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
