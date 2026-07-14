import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Link2, Loader2, Pin, RefreshCw, Unlink, Pencil } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

function parseErrorMessage(payload, fallback) {
	if (typeof payload === 'string' && payload.trim()) {
		return payload;
	}
	if (payload?.message && typeof payload.message === 'string') {
		return payload.message;
	}
	return fallback;
}

export default function PinterestPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const location = useLocation();
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState('');
	const [connecting, setConnecting] = useState(false);
	const [processingAccountId, setProcessingAccountId] = useState('');
	const [editingLabelId, setEditingLabelId] = useState('');
	const [labelDraft, setLabelDraft] = useState('');
	const [accounts, setAccounts] = useState([]);
	const [summary, setSummary] = useState({ totalAccounts: 0, totalBoards: 0, totalPublishedPins: 0 });
	const [boardsByAccount, setBoardsByAccount] = useState({});

	const connectedCount = useMemo(
		() => accounts.filter((account) => account.status === 'connected').length,
		[accounts],
	);

	const load = async () => {
		setLoading(true);
		try {
			const accountsRes = await apiServerClient.fetch(`/pinterest/accounts${filter ? `?filter=${encodeURIComponent(filter)}` : ''}`, { method: 'GET' });
			const accountsPayload = await accountsRes.json().catch(() => ({}));
			if (!accountsRes.ok) {
				throw new Error(parseErrorMessage(accountsPayload, `Failed to load Pinterest accounts (${accountsRes.status})`));
			}

			const accountItems = Array.isArray(accountsPayload.items) ? accountsPayload.items : [];
			setAccounts(accountItems);
			setSummary(accountsPayload.summary || { totalAccounts: 0, totalBoards: 0, totalPublishedPins: 0 });

			const connectedAccounts = accountItems.filter((account) => account.status === 'connected');
			const boardsEntries = await Promise.all(connectedAccounts.map(async (account) => {
				const boardsRes = await apiServerClient.fetch(`/pinterest/boards?accountId=${encodeURIComponent(account.id)}`, { method: 'GET' });
				const boardsPayload = await boardsRes.json().catch(() => []);
				if (!boardsRes.ok) {
					return [account.id, []];
				}
				return [account.id, Array.isArray(boardsPayload) ? boardsPayload : []];
			}));

			setBoardsByAccount(Object.fromEntries(boardsEntries));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, [filter]);

	useEffect(() => {
		const searchParams = new URLSearchParams(location.search);
		const connectedParam = searchParams.get('pinterest_connected');
		const connectedAccountId = searchParams.get('account_id');
		const errorParam = searchParams.get('pinterest_error');

		if (!connectedParam && !errorParam) {
			return;
		}

		if (connectedParam === '1') {
			toast({ title: 'Pinterest connected', description: connectedAccountId ? `Account linked: ${connectedAccountId}` : 'Your Pinterest account is now linked successfully.' });
			load();
		}
		if (errorParam) {
			toast({ variant: 'destructive', title: 'Pinterest connection failed', description: decodeURIComponent(errorParam) });
		}

		navigate('/app/pinterest', { replace: true });
	}, [location.search]);

	const connectPinterest = async () => {
		setConnecting(true);
		try {
			const response = await apiServerClient.fetch('/pinterest/oauth/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: '' }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to start Pinterest OAuth (${response.status})`));
			}
			if (!payload?.authUrl) {
				throw new Error('Pinterest OAuth URL is missing from server response');
			}
			window.location.assign(payload.authUrl);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
			setConnecting(false);
		}
	};

	const disconnectPinterest = async () => {
		setDisconnecting(true);
		try {
			const response = await apiServerClient.fetch('/pinterest/disconnect', { method: 'POST' });
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(parseErrorMessage(payload, `Failed to disconnect Pinterest (${response.status})`));
			}
			setAccount({ connected: false });
			setBoards([]);
			toast({ title: 'Pinterest disconnected', description: 'Your tokens and boards were removed safely.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setDisconnecting(false);
		}
	};

	const syncBoards = async () => {
		setSyncingBoards(true);
		try {
			const response = await apiServerClient.fetch('/pinterest/boards/sync', { method: 'POST' });
			const payload = await response.json().catch(() => []);
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to sync boards (${response.status})`));
			}
			setBoards(Array.isArray(payload) ? payload : []);
			toast({ title: 'Boards synced', description: 'Pinterest boards were refreshed successfully.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setSyncingBoards(false);
		}
	};

	const accountStatus = useMemo(() => {
		if (!connected) {
			return 'Not connected';
	const reconnectAccount = async (account) => {
		setProcessingAccountId(account.id);
			return `Connected as @${account.username}`;
			const response = await apiServerClient.fetch(`/pinterest/accounts/${account.id}/reconnect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: account.label || '' }),
			});
			const payload = await response.json().catch(() => ({}));
		return 'Connected';
				throw new Error(parseErrorMessage(payload, `Failed to reconnect account (${response.status})`));
	return (
			if (!payload?.authUrl) {
				throw new Error('Reconnect URL was not returned by server');
			}
			window.location.assign(payload.authUrl);
				subtitle="Connect your Pinterest account, sync boards, and use publishing tools from AI Pins and Calendar."
				action={
					connected ? (
			setProcessingAccountId('');
							<Button variant="outline" onClick={syncBoards} disabled={syncingBoards || loading}>
								{syncingBoards ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={16} />} Sync Boards
							</Button>
	const syncAccountBoards = async (account) => {
		setProcessingAccountId(account.id);
							</Button>
			const response = await apiServerClient.fetch('/pinterest/boards/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accountId: account.id }),
			});
			const payload = await response.json().catch(() => ({}));
						<Button onClick={connectPinterest} disabled={connecting || loading}>
							{connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={16} />} Connect Pinterest
						</Button>
			setBoardsByAccount((prev) => ({
				...prev,
				[account.id]: Array.isArray(payload.items) ? payload.items : [],
			}));
			toast({ title: 'Boards synced', description: `Boards refreshed for ${account.label || account.username}` });
			/>

			<Card className="mb-6 flex items-center justify-between gap-3">
			setProcessingAccountId('');
					<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-500"><Pin size={20} /></span>
					<div>
						<p className="font-semibold">Pinterest account status</p>
	const disconnectAccount = async (account) => {
		setProcessingAccountId(account.id);
		try {
			const response = await apiServerClient.fetch(`/pinterest/accounts/${account.id}/disconnect`, { method: 'POST' });
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(parseErrorMessage(payload, `Failed to disconnect account (${response.status})`));
			}
			toast({ title: 'Account disconnected', description: `${account.label || account.username} was disconnected.` });
			load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setProcessingAccountId('');
		}
	};

	const renameAccount = async (accountId) => {
		if (!labelDraft.trim()) {
			toast({ variant: 'destructive', title: 'Label required', description: 'Please enter a valid account label.' });
			return;
		}

		setProcessingAccountId(accountId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/accounts/${accountId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: labelDraft.trim() }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to rename account (${response.status})`));
			}
			toast({ title: 'Account renamed', description: 'Custom label updated successfully.' });
			setEditingLabelId('');
			setLabelDraft('');
			load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setProcessingAccountId('');
		}
	};

	const statusTone = (status) => {
		if (status === 'connected') {
			return 'green';
		}
		if (status === 'expired') {
			return 'amber';
		}
		return 'red';
	};
				<Empty icon={Pin} title="Pinterest not connected" subtitle="Connect your Pinterest account to load boards and publish scheduled AI pins." />
			) : boards.length === 0 ? (
				<Empty icon={Pin} title="No boards found" subtitle="Create Pinterest boards in your account, then click Sync Boards." />
			) : (
				title="Pinterest Accounts"
				subtitle="Connect and manage multiple Pinterest accounts for publishing and automation."
				action={<Button onClick={connectPinterest} disabled={connecting || loading}>{connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={16} />} Connect New Account</Button>}
		</div>
	);
			<div className="mb-4 grid gap-4 md:grid-cols-4">
				<Card>
					<p className="text-xs text-muted-foreground">Total Accounts</p>
					<p className="mt-1 text-2xl font-bold tabular-nums">{summary.totalAccounts}</p>
				</Card>
				<Card>
					<p className="text-xs text-muted-foreground">Connected Accounts</p>
					<p className="mt-1 text-2xl font-bold tabular-nums">{connectedCount}</p>
				</Card>
				<Card>
					<p className="text-xs text-muted-foreground">Total Boards</p>
					<p className="mt-1 text-2xl font-bold tabular-nums">{summary.totalBoards}</p>
				</Card>
				<Card>
					<p className="text-xs text-muted-foreground">Published Pins</p>
					<p className="mt-1 text-2xl font-bold tabular-nums">{summary.totalPublishedPins}</p>
				</Card>
			</div>

			<Card className="mb-6">
				<div className="grid gap-3 md:grid-cols-3">
					<Select label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
						<option value="">All</option>
						<option value="connected">Connected</option>
						<option value="expired">Expired</option>
						<option value="active">Active</option>
						<option value="error">Error</option>
					</Select>
					<div className="md:col-span-2 flex items-end">
						<p className="text-sm text-muted-foreground">Manage account labels, reconnect expired accounts, and sync boards per account.</p>
					</div>
				</div>
			</Card>

			{loading ? (
				<div className="flex items-center justify-center py-10 text-muted-foreground"><Spinner className="mr-2 h-4 w-4" /> Loading Pinterest accounts...</div>
			) : accounts.length === 0 ? (
				<Empty icon={Pin} title="No connected Pinterest accounts" subtitle="Connect your first Pinterest account to start publishing." />
			) : (
				<div className="space-y-4">
					{accounts.map((account) => (
						<Card key={account.id}>
							<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
								<div className="flex min-w-0 gap-3">
									<div className="h-14 w-14 overflow-hidden rounded-xl border border-border bg-secondary/30">
										{account.profileImageUrl ? (
											<img src={account.profileImageUrl} alt={account.accountName || account.username} loading="lazy" decoding="async" className="h-full w-full object-cover" />
										) : (
											<div className="flex h-full items-center justify-center text-muted-foreground"><Pin size={20} /></div>
										)}
									</div>
									<div className="min-w-0">
										<p className="truncate font-semibold">{account.label || account.accountName || account.username || 'Pinterest account'}</p>
										<p className="truncate text-sm text-muted-foreground">{account.accountName || 'Unnamed account'} • @{account.username || 'unknown'}</p>
										<p className="text-xs text-muted-foreground">Connected: {account.connectedAt ? new Date(account.connectedAt).toLocaleString() : '—'}</p>
										<p className="text-xs text-muted-foreground">Published Pins: {account.publishedPins || 0} • Boards: {account.boardCount || 0}</p>
										{account.statusError ? <p className="mt-1 text-xs text-red-600">{account.statusError}</p> : null}
									</div>
								</div>

								<div className="flex flex-wrap items-center gap-2">
									<Badge tone={statusTone(account.status)}>{account.status}</Badge>
									<Button size="sm" variant="outline" disabled={processingAccountId === account.id} onClick={() => syncAccountBoards(account)}>
										{processingAccountId === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />} Sync Boards
									</Button>
									{account.status !== 'connected' ? (
										<Button size="sm" variant="outline" disabled={processingAccountId === account.id} onClick={() => reconnectAccount(account)}>
											<Link2 size={14} /> Reconnect
										</Button>
									) : null}
									<Button size="sm" variant="outline" disabled={processingAccountId === account.id} onClick={() => {
										setEditingLabelId(account.id);
										setLabelDraft(account.label || account.accountName || account.username || '');
									}}>
										<Pencil size={14} /> Rename
									</Button>
									<Button size="sm" variant="outline" disabled={processingAccountId === account.id} onClick={() => disconnectAccount(account)}>
										<Unlink size={14} /> Disconnect
									</Button>
								</div>
							</div>

							{editingLabelId === account.id ? (
								<div className="mt-3 flex flex-col gap-2 md:flex-row">
									<div className="flex-1">
										<Input label="Custom Label" value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} />
									</div>
									<div className="flex items-end gap-2">
										<Button size="sm" onClick={() => renameAccount(account.id)} disabled={processingAccountId === account.id}>Save Label</Button>
										<Button size="sm" variant="outline" onClick={() => setEditingLabelId('')}>Cancel</Button>
									</div>
								</div>
							) : null}

							<div className="mt-3">
								<p className="mb-2 text-xs font-medium text-muted-foreground">Boards</p>
								{(boardsByAccount[account.id] || []).length === 0 ? (
									<p className="text-xs text-muted-foreground">No boards loaded.</p>
								) : (
									<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
										{(boardsByAccount[account.id] || []).slice(0, 9).map((board) => (
											<div key={board.id} className="rounded-xl border border-border p-2">
												<p className="truncate text-sm font-medium">{board.name}</p>
												<p className="truncate text-xs text-muted-foreground">{board.boardId}</p>
											</div>
										))}
									</div>
								)}
							</div>
						</Card>
					))}
				</div>
			)}
