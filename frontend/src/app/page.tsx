"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Copy, Activity, Repeat, Layers,
  Bell, Search, Download, Plus,
  Trash2, Globe, CheckCircle, RefreshCw } from 'lucide-react';
import { 
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, 
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell 
} from 'recharts';
import { io } from 'socket.io-client';

const COLORS = ['#000000', '#4b5563', '#94a3b8', '#374151', '#1f2937', '#111827'];

function CopyableHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return null;
  const short = hash.substring(0, 6) + '...' + hash.substring(hash.length - 4);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 border border-black bg-white hover:bg-slate-100 transition-colors duration-150">
      <span className="font-mono text-[10px] font-extrabold text-black">{short}</span>
      <button 
        onClick={handleCopy}
        className="p-0.5 text-black hover:text-slate-600 transition-colors bg-transparent border-0 cursor-pointer flex items-center justify-center focus:outline-none"
        title="Copy Hash/Address"
      >
        {copied ? (
          <CheckCircle className="h-3 w-3 text-black" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </span>
  );
}

export default function ChainScopeDashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'explorer' | 'analytics' | 'swaps' | 'nfts' | 'rules'>('dashboard');
  const [events, setEvents] = useState<any[]>([]);
  const [syncStats, setSyncStats] = useState({
    postgres: 'UP',
    redis: 'UP',
    ethereumSepoliaRpc: 'UP',
    baseSepoliaRpc: 'UP',
    lagSepolia: 0,
    lagBaseSepolia: 0,
    syncedBlockSepolia: 0,
    syncedBlockBase: 0
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [explorerFilter, setExplorerFilter] = useState<'all' | 'transfer' | 'swap' | 'nft'>('all');
  const [explorerChain, setExplorerChain] = useState<number | 'all'>('all');

  const [rules, setRules] = useState<any[]>([]);
  const [alertLogs, setAlertLogs] = useState<any[]>([]);
  const [swapsList, setSwapsList] = useState<any[]>([]);
  const [nftsList, setNftsList] = useState<any[]>([]);

  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleType, setNewRuleType] = useState<'WHALE' | 'REORG'>('WHALE');
  const [newRuleChain, setNewRuleChain] = useState<number>(11155111);
  const [newRuleToken, setNewRuleToken] = useState('');
  const [newRuleThreshold, setNewRuleThreshold] = useState('');
  const [newRuleTelegram, setNewRuleTelegram] = useState('');

  const [volumeData, setVolumeData] = useState<any[]>([]);

  const [summaryStats, setSummaryStats] = useState<{
    eventsPerMinute: number;
    meanTransferUsd: number | null;
    topSender: { address: string; txCountSent: number; txCountReceived: number; chainId: number } | null;
    topReceiver: { address: string; txCountSent: number; txCountReceived: number; chainId: number } | null;
  }>({
    eventsPerMinute: 0,
    meanTransferUsd: null,
    topSender: null,
    topReceiver: null
  });

  const [swapPairData, setSwapPairData] = useState<any[]>([]);
  const [nftCollections, setNftCollections] = useState<any[]>([]);

  const fetchLatestEvents = async (overrideChain?: number | 'all') => {
    try {
      const targetChain = overrideChain !== undefined ? overrideChain : explorerChain;
      const chainQuery = targetChain !== 'all' ? `&chainId=${targetChain}` : '';
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/events?limit=50${chainQuery}`);
      if (res.ok) {
        const json = await res.json();
        setEvents(json.data);
      }
    } catch (error) {
      console.error('Failed to fetch latest events:', error);
    }
  };

  useEffect(() => {
    fetchLatestEvents(explorerChain);
  }, [explorerChain]);

  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000', {
      transports: ['websocket'],
      autoConnect: true
    });

    socket.on('connect', () => {
      console.log('🔌 Next.js dashboard Socket.IO connected!');
      socket.emit('subscribe:transfers');
      socket.emit('subscribe:swaps');
      socket.emit('subscribe:nfts');
    });

    socket.on('transfer', (data) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === data.id)) return prev;
        return [
          {
            id: data.id || Math.random().toString(),
            type: 'transfer',
            chainId: data.chainId,
            txHash: data.txHash,
            tokenSymbol: data.tokenSymbol,
            amount: data.normalizedAmount,
            usdValue: data.usdValue,
            fromAddress: data.fromAddress,
            toAddress: data.toAddress,
            timestamp: data.timestamp || new Date().toISOString()
          },
          ...prev
        ].slice(0, 50);
      });
    });

    socket.on('swap', (data) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === data.id)) return prev;
        return [
          {
            id: data.id || Math.random().toString(),
            type: 'swap',
            chainId: data.chainId,
            txHash: data.txHash,
            poolAddress: data.poolAddress,
            protocol: data.protocol,
            tokenInSymbol: data.tokenInSymbol,
            tokenOutSymbol: data.tokenOutSymbol,
            amountInNormalized: data.amountInNormalized,
            amountOutNormalized: data.amountOutNormalized,
            amountUsd: data.amountUsd,
            sender: data.sender,
            recipient: data.recipient,
            timestamp: data.timestamp || new Date().toISOString()
          },
          ...prev
        ].slice(0, 50);
      });
    });

    socket.on('nft', (data) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === data.id)) return prev;
        return [
          {
            id: data.id || Math.random().toString(),
            type: 'nft',
            chainId: data.chainId,
            txHash: data.txHash,
            contractAddress: data.contractAddress,
            collectionSymbol: data.collectionSymbol,
            collectionName: data.collectionName,
            typeLabel: data.type,
            fromAddress: data.fromAddress,
            toAddress: data.toAddress,
            tokenId: data.tokenId,
            amount: data.amount,
            timestamp: data.timestamp || new Date().toISOString()
          },
          ...prev
        ].slice(0, 50);
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchHealthStats = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setSyncStats((prev) => ({
          ...prev,
          postgres: data.details.postgres,
          redis: data.details.redis,
          ethereumSepoliaRpc: data.details.ethereumSepoliaRpc || 'UP',
          baseSepoliaRpc: data.details.baseSepoliaRpc || 'UP',
          lagSepolia: data.details.lagSepolia || 0,
          lagBaseSepolia: data.details.lagBaseSepolia || 0,
          syncedBlockSepolia: data.details.syncedBlockSepolia ?? prev.syncedBlockSepolia,
          syncedBlockBase: data.details.syncedBlockBase ?? prev.syncedBlockBase
        }));
      }
    } catch {}
  };

  const fetchSummary = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/analytics/summary`);
      if (res.ok) {
        const json = await res.json();
        setSummaryStats({
          eventsPerMinute: json.data.eventsPerMinute ?? 0,
          meanTransferUsd: json.data.meanTransferUsd ?? null,
          topSender: json.data.topSender ?? null,
          topReceiver: json.data.topReceiver ?? null
        });
      }
    } catch {}
  };

  const fetchSwapPairs = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/stats/swap-pairs?periodHours=24`);
      if (res.ok) {
        const json = await res.json();
        setSwapPairData(json.data.map((p: any) => ({
          name: p.pair,
          value: p.percentage
        })));
      }
    } catch {}
  };

  const fetchNftCollections = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/stats/nft-collections`);
      if (res.ok) {
        const json = await res.json();
        setNftCollections(json.data.map((c: any) => ({
          contractAddress: c.contractAddress,
          chainId: c.chainId,
          name: c.name,
          symbol: c.symbol,
          mints: c.mints,
          transfers: c.transfers,
          burns: c.burns,
          total: c.total
        })));
      }
    } catch {}
  };

  const fetchAlertRules = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/alerts/rules`);
      if (res.ok) {
        const json = await res.json();
        setRules(json.data);
      }
    } catch {}
  };

  const fetchAlertLogs = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/alerts/logs`);
      if (res.ok) {
        const json = await res.json();
        setAlertLogs(json.data.map((l: any) => ({
          id: l.id,
          ruleName: l.rule.name,
          type: l.type,
          message: l.message,
          recipient: l.recipient,
          status: l.status,
          createdAt: l.createdAt
        })));
      }
    } catch {}
  };

  const fetchVolumeStats = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/stats/volume?periodHours=24`);
      if (res.ok) {
        const json = await res.json();
        // Use txCount as the volume metric since Pyth USD prices may be null on testnet
        const formatted = json.data.map((s: any) => ({
          name: s.symbol,
          SepoliaVolume: s.chainId === 11155111 ? (s.txCount || 0) : 0,
          BaseVolume: s.chainId === 84532 ? (s.txCount || 0) : 0
        }));
        if (formatted.length > 0) {
          setVolumeData(formatted);
        }
      }
    } catch {}
  };

  const fetchSwapsList = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/swaps?limit=50`);
      if (res.ok) {
        const json = await res.json();
        setSwapsList(json.data.map((s: any) => ({
          id: s.id,
          type: 'swap',
          chainId: s.chainId,
          txHash: s.txHash,
          poolAddress: s.poolAddress,
          protocol: s.protocol,
          tokenInSymbol: s.tokenIn?.symbol || '???',
          tokenOutSymbol: s.tokenOut?.symbol || '???',
          amountInNormalized: s.amountInNormalized,
          amountOutNormalized: s.amountOutNormalized,
          amountUsd: s.amountUsd,
          sender: s.sender,
          recipient: s.recipient,
          timestamp: s.timestamp
        })));
      }
    } catch {}
  };

  const fetchNftsList = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/nfts?limit=50`);
      if (res.ok) {
        const json = await res.json();
        setNftsList(json.data.map((n: any) => ({
          id: n.id,
          type: 'nft',
          chainId: n.chainId,
          txHash: n.txHash,
          contractAddress: n.contractAddress,
          collectionSymbol: n.collection?.symbol || 'NFT',
          collectionName: n.collection?.name || 'Unknown Collection',
          typeLabel: n.type,
          fromAddress: n.fromAddress,
          toAddress: n.toAddress,
          tokenId: n.tokenId,
          amount: n.amount,
          timestamp: n.timestamp
        })));
      }
    } catch {}
  };

  useEffect(() => {
    fetchHealthStats();
    fetchSummary();
    fetchAlertRules();
    fetchAlertLogs();
    fetchVolumeStats();
    fetchLatestEvents();
    fetchSwapsList();
    fetchNftsList();
    fetchSwapPairs();
    fetchNftCollections();

    const interval = setInterval(() => {
      fetchHealthStats();
      fetchSummary();
      fetchVolumeStats();
      fetchLatestEvents();
      fetchSwapsList();
      fetchNftsList();
      fetchSwapPairs();
      fetchNftCollections();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName) return;

    try {
      const payload = {
        name: newRuleName,
        type: newRuleType,
        chainId: newRuleChain,
        tokenAddress: newRuleToken || undefined,
        thresholdUsd: newRuleThreshold ? parseFloat(newRuleThreshold) : undefined,
        recipientTelegram: newRuleTelegram || undefined
      };

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/alerts/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        fetchAlertRules();
        setNewRuleName('');
        setNewRuleToken('');
        setNewRuleThreshold('');
        setNewRuleTelegram('');
      } else {
        alert('Failed to insert rule. Verify inputs.');
      }
    } catch (err) {
      console.error('Failed to create alert rule:', err);
      alert('Could not reach the server. Please try again.');
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/alerts/rules/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchAlertRules();
      }
    } catch {
      setRules((prev) => prev.filter(r => r.id !== id));
    }
  };

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (explorerChain !== 'all' && e.chainId !== explorerChain) return false;
      if (explorerFilter !== 'all' && e.type !== explorerFilter) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesHash = e.txHash?.toLowerCase()?.includes(query);
        const matchesFrom = e.fromAddress?.toLowerCase()?.includes(query) || e.sender?.toLowerCase()?.includes(query);
        const matchesTo = e.toAddress?.toLowerCase()?.includes(query) || e.recipient?.toLowerCase()?.includes(query);
        const matchesSymbol = e.tokenSymbol?.toLowerCase()?.includes(query) || e.collectionSymbol?.toLowerCase()?.includes(query);
        return matchesHash || matchesFrom || matchesTo || matchesSymbol;
      }
      return true;
    });
  }, [events, searchQuery, explorerFilter, explorerChain]);

  const handleExportCSV = () => {
    const headers = 'ID,Type,ChainId,TransactionHash,Asset,Amount,USDValue,From,To,Timestamp\n';
    const rows = filteredEvents.map(e => {
      const asset = e.type === 'transfer' ? e.tokenSymbol : e.type === 'swap' ? `${e.tokenInSymbol}->${e.tokenOutSymbol}` : e.collectionSymbol;
      const amount = e.type === 'transfer' ? e.amount : e.type === 'swap' ? e.amountInNormalized : e.tokenId;
      const val = e.type === 'nft' ? e.amount : e.usdValue || e.amountUsd || '';
      return `"${e.id}","${e.type}","${e.chainId}","${e.txHash}","${asset}","${amount}","${val}","${e.fromAddress}","${e.toAddress}","${e.timestamp}"`;
    }).join('\n');
    
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chainscope_explorer_export_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-slate-100 text-black flex flex-col font-['Outfit',sans-serif]">
      
      <header className="w-full bg-white border-b-2 border-black sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 bg-black flex items-center justify-center text-white">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-black uppercase tracking-tight leading-none text-black">
                ChainScope
              </h1>
              <span className="text-[9px] font-extrabold text-black uppercase tracking-widest block mt-0.5">Multi-Chain Syncer</span>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-1 md:gap-2">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 text-xs navbar-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            >
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('explorer')}
              className={`px-3 py-1.5 text-xs navbar-tab ${activeTab === 'explorer' ? 'active' : ''}`}
            >
              Ledger
            </button>
            <button 
              onClick={() => setActiveTab('analytics')}
              className={`px-3 py-1.5 text-xs navbar-tab ${activeTab === 'analytics' ? 'active' : ''}`}
            >
              Analytics
            </button>
            <button 
              onClick={() => setActiveTab('swaps')}
              className={`px-3 py-1.5 text-xs navbar-tab ${activeTab === 'swaps' ? 'active' : ''}`}
            >
              DEX Swaps
            </button>
            <button
              onClick={() => setActiveTab('nfts')}
              className={`px-3 py-1.5 text-xs navbar-tab ${activeTab === 'nfts' ? 'active' : ''}`}
            >
              NFT Feeds
            </button>
            <button
              onClick={() => setActiveTab('rules')}
              className={`px-3 py-1.5 text-xs navbar-tab ${activeTab === 'rules' ? 'active' : ''}`}
            >
              Alert Builder
            </button>
          </nav>

          <div className="flex items-center space-x-4 text-[10px] font-black uppercase">
            <div className="flex items-center space-x-1.5">
              <span>DB</span>
              <span className={`h-2 w-2 border border-black ${syncStats.postgres === 'UP' ? 'bg-black' : 'bg-white'}`} />
            </div>
            <div className="flex items-center space-x-1.5">
              <span>Ethereum</span>
              <span className={`h-2 w-2 border border-black ${syncStats.ethereumSepoliaRpc === 'UP' ? 'bg-black' : 'bg-white'}`} />
            </div>
            <div className="flex items-center space-x-1.5">
              <span>Base</span>
              <span className={`h-2 w-2 border border-black ${syncStats.baseSepoliaRpc === 'UP' ? 'bg-black' : 'bg-white'}`} />
            </div>
          </div>

        </div>
      </header>

      <main className="flex-grow w-full max-w-7xl mx-auto px-6 py-10 relative">
        <div className="animate-quick-fade space-y-10">
          
          {activeTab === 'dashboard' && (
            <div className="space-y-10">
              
              <div className="flex items-center justify-between border-b-2 border-black pb-4">
                <div>
                  <h2 className="text-2xl font-black uppercase text-black tracking-tight">Sync Diagnostics Center</h2>
                  <p className="text-xs text-slate-700 mt-1 font-bold">Real-time status indicators and active logs for blockchain testnets.</p>
                </div>
                <button 
                  onClick={() => { fetchHealthStats(); fetchVolumeStats(); fetchLatestEvents(); }}
                  className="flex items-center space-x-2 px-4 py-2 brutalist-button text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh Engine</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                
                <div className="col-span-1 md:col-span-2 brutalist-card p-6">
                  <div className="flex justify-between items-start border-b border-black pb-2 mb-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-black">Sepolia Block Ingest</span>
                    <Globe className="h-4 w-4 text-black" />
                  </div>
                  <div>
                    <span className="text-3xl font-black text-black block tracking-tight">#{syncStats.syncedBlockSepolia.toLocaleString()}</span>
                    <div className="mt-2 text-xs font-bold text-slate-700">
                      Sync Lag: <span className="underline">{syncStats.lagSepolia} blocks</span>
                    </div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 brutalist-card p-6">
                  <div className="flex justify-between items-start border-b border-black pb-2 mb-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-black">Base Block</span>
                    <Globe className="h-4 w-4 text-black" />
                  </div>
                  <div>
                    <span className="text-2xl font-black text-black block tracking-tight">#{syncStats.syncedBlockBase.toLocaleString()}</span>
                    <div className="mt-2 text-xs font-bold text-slate-700">
                      Lag: <span className="underline">{syncStats.lagBaseSepolia} blks</span>
                    </div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 brutalist-card p-6">
                  <div className="flex justify-between items-start border-b border-black pb-2 mb-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-black">Event Flow</span>
                    <Activity className="h-4 w-4 text-black" />
                  </div>
                  <div>
                    <span className="text-2xl font-black text-black block tracking-tight">{summaryStats.eventsPerMinute} e/m</span>
                    <div className="mt-2 text-xs font-bold text-slate-700">Events / min (last 5m)</div>
                  </div>
                </div>

              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className="lg:col-span-2 brutalist-card p-6 flex flex-col justify-between h-[480px]">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b-2 border-black mb-4">
                      <h3 className="font-black text-xs uppercase tracking-wider flex items-center space-x-2 text-black">
                        <span className="h-2.5 w-2.5 bg-black inline-block animate-pulse" />
                        <span>Sync Waterfall Stream Log</span>
                      </h3>
                      <span className="text-[9px] font-extrabold uppercase border border-black px-2 py-0.5 bg-slate-200">Testnet Live Nodes</span>
                    </div>

                    <div className="space-y-3 overflow-y-auto max-h-[350px] pr-2 text-xs font-bold text-black">
                      {events.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[280px]">
                          <Activity className="h-8 w-8 text-black animate-pulse mb-2" />
                          <span>Listening for live testnet blockchain events...</span>
                        </div>
                      ) : (
                        events.map((e) => (
                          <div 
                            key={e.id} 
                            className="flex justify-between items-center bg-white border border-black p-3"
                          >
                            <div className="flex items-center space-x-3">
                              <span className="border border-black bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase">
                                {e.chainId === 11155111 ? 'Sepolia' : 'Base'}
                              </span>

                              {e.type === 'transfer' && (
                                <span>
                                  💸 <b>Transfer:</b> {parseFloat(e.amount).toLocaleString()} {e.tokenSymbol} (${e.usdValue?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '---'})
                                </span>
                              )}
                              {e.type === 'swap' && (
                                <span>
                                  🔀 <b>Swap:</b> {parseFloat(e.amountInNormalized).toLocaleString()} {e.tokenInSymbol} ➔ {parseFloat(e.amountOutNormalized).toLocaleString()} {e.tokenOutSymbol} (${e.amountUsd?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '---'})
                                </span>
                              )}
                              {e.type === 'nft' && (
                                <span>
                                  🖼️ <b>NFT {e.typeLabel}:</b> {e.collectionSymbol} #{e.tokenId} by <CopyableHash hash={e.toAddress} />
                                </span>
                              )}
                            </div>

                            <div className="flex items-center space-x-3">
                              <CopyableHash hash={e.txHash} />
                              <span className="text-[10px] text-slate-600 font-extrabold">just now</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="brutalist-card p-6 h-[480px] flex flex-col justify-between">
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-6 text-black">
                      Aggregated Ingestion Volume
                    </h3>
                    <div className="h-[320px]">
                      {volumeData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-xs font-bold text-slate-600">
                          <Activity className="h-8 w-8 text-black animate-pulse mb-2" />
                          <span>Loading volume...</span>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={volumeData}>
                            <XAxis dataKey="name" stroke="#000000" fontSize={9} tickLine={false} />
                            <YAxis stroke="#000000" fontSize={9} tickLine={false} />
                            <Tooltip
                              contentStyle={{
                                background: '#ffffff',
                                border: '2px solid #000000',
                                color: '#000000',
                                borderRadius: '0px',
                                fontSize: '11px',
                                fontWeight: 'bold'
                              }}
                            />
                            <Area type="monotone" dataKey="SepoliaVolume" stroke="#000000" fill="#ffffff" fillOpacity={0.6} strokeWidth={2} name="Sepolia Vol ($)" />
                            <Area type="monotone" dataKey="BaseVolume" stroke="#4b5563" fill="#94a3b8" fillOpacity={0.3} strokeWidth={2} name="Base Vol ($)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {activeTab === 'explorer' && (
            <div className="space-y-10">
              <div className="border-b-2 border-black pb-4">
                <h2 className="text-2xl font-black uppercase text-black tracking-tight">On-Chain Sync Ledger</h2>
                <p className="text-xs text-slate-700 mt-1 font-bold">Comprehensive, high-contrast, filterable registry of captured events.</p>
              </div>

              <div className="brutalist-card p-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-3.5 h-4 w-4 text-black" />
                    <input 
                      type="text"
                      placeholder="Search ledger logs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-3 brutalist-input focus:outline-none"
                    />
                  </div>

                  <select 
                    value={explorerFilter} 
                    onChange={(e: any) => setExplorerFilter(e.target.value)}
                    className="px-4 py-3 brutalist-input cursor-pointer"
                  >
                    <option value="all">All Ingestion Types</option>
                    <option value="transfer">Transfers (ERC-20)</option>
                    <option value="swap">Pool DEX Swaps</option>
                    <option value="nft">ERC-721 Collection sales</option>
                  </select>

                  <select 
                    value={explorerChain} 
                    onChange={(e: any) => setExplorerChain(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                    className="px-4 py-3 brutalist-input cursor-pointer"
                  >
                    <option value="all">All Indexed Chains</option>
                    <option value="11155111">Ethereum Sepolia</option>
                    <option value="84532">Base Sepolia</option>
                  </select>

                  <button 
                    onClick={handleExportCSV}
                    className="flex items-center justify-center space-x-2 py-3 px-6 brutalist-button text-xs font-black cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download Ledger CSV</span>
                  </button>
                </div>
              </div>

              <div className="brutalist-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b-2 border-black bg-slate-200 text-black font-black uppercase tracking-wider text-[10px]">
                        <th className="p-4 border-r border-black">Chain</th>
                        <th className="p-4 border-r border-black">Ingest Type</th>
                        <th className="p-4 border-r border-black">Transaction Hash</th>
                        <th className="p-4 border-r border-black">From Address</th>
                        <th className="p-4 border-r border-black">To Recipient</th>
                        <th className="p-4 border-r border-black">Symbol</th>
                        <th className="p-4 border-r border-black">Synced Value / Amount</th>
                        <th className="p-4">Time Captured</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black font-bold text-black">
                      {filteredEvents.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-500 bg-white">
                            No ledger logs match current configurations.
                          </td>
                        </tr>
                      ) : (
                        filteredEvents.map((e) => (
                          <tr key={e.id} className="hover:bg-slate-100 bg-white">
                            <td className="p-4 border-r border-black">
                              <span className="border border-black bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase">
                                {e.chainId === 11155111 ? 'Sepolia' : 'Base'}
                              </span>
                            </td>
                            <td className="p-4 border-r border-black uppercase text-[9px]">
                              {e.type === 'transfer' && '💸 Transfer'}
                              {e.type === 'swap' && '🔀 Pool DEX Swap'}
                              {e.type === 'nft' && `🖼️ NFT ${e.typeLabel}`}
                            </td>
                            <td className="p-4 border-r border-black"><CopyableHash hash={e.txHash} /></td>
                            <td className="p-4 border-r border-black"><CopyableHash hash={e.fromAddress || e.sender} /></td>
                            <td className="p-4 border-r border-black">
                              {e.toAddress || e.recipient ? (
                                <CopyableHash hash={e.toAddress || e.recipient} />
                              ) : (
                                <span className="text-slate-400">---</span>
                              )}
                            </td>
                            <td className="p-4 border-r border-black font-black">
                              {e.type === 'transfer' && e.tokenSymbol}
                              {e.type === 'swap' && `${e.tokenInSymbol}➔${e.tokenOutSymbol}`}
                              {e.type === 'nft' && e.collectionSymbol}
                            </td>
                            <td className="p-4 border-r border-black font-black">
                              {e.type === 'transfer' && `${parseFloat(e.amount).toLocaleString()} (${e.usdValue ? `$${e.usdValue.toLocaleString()}` : '---'})`}
                              {e.type === 'swap' && `${parseFloat(e.amountInNormalized).toLocaleString()} (${e.amountUsd ? `$${e.amountUsd.toLocaleString()}` : '---'})`}
                              {e.type === 'nft' && `Token ID #${e.tokenId}`}
                            </td>
                            <td className="p-4 text-slate-500 font-semibold">{new Date(e.timestamp).toLocaleTimeString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="space-y-10">
              <div className="border-b-2 border-black pb-4">
                <h2 className="text-2xl font-black uppercase text-black tracking-tight">Valuation Aggregate Analytics</h2>
                <p className="text-xs text-slate-700 mt-1 font-bold">Asymmetrical charts representing block and holder density index values.</p>
              </div>

              <div className="brutalist-card p-6">
                <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-6 text-black">
                  24h Token Volume Distribution
                </h3>
                <div className="h-[300px]">
                  {volumeData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-xs font-bold text-slate-600">
                      <Activity className="h-8 w-8 text-black animate-pulse mb-2" />
                      <span>Loading volume...</span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={volumeData}>
                        <XAxis dataKey="name" stroke="#000000" fontSize={9} tickLine={false} />
                        <YAxis stroke="#000000" fontSize={9} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            background: '#ffffff',
                            border: '2px solid #000000',
                            color: '#000000',
                            borderRadius: '0px',
                            fontSize: '11px',
                            fontWeight: 'bold'
                          }}
                        />
                        <Bar dataKey="SepoliaVolume" fill="#000000" name="Sepolia ($)" />
                        <Bar dataKey="BaseVolume" fill="#94a3b8" name="Base ($)" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="brutalist-card p-6">
                <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-6 text-black">
                  Node Interaction Leaderboards
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-black">
                  <div className="bg-white border-2 border-black p-5 text-center space-y-1">
                    <span className="text-[9px] text-slate-600 font-extrabold uppercase tracking-widest block">Top Active Sender</span>
                    {summaryStats.topSender ? (
                      <>
                        <span className="block my-1"><CopyableHash hash={summaryStats.topSender.address} /></span>
                        <span className="text-base font-black block mt-2">{summaryStats.topSender.txCountSent.toLocaleString()} Sent</span>
                      </>
                    ) : (
                      <span className="text-base font-black block mt-2 text-slate-400">N/A</span>
                    )}
                  </div>
                  <div className="bg-white border-2 border-black p-5 text-center space-y-1">
                    <span className="text-[9px] text-slate-600 font-extrabold uppercase tracking-widest block">Top Active Receiver</span>
                    {summaryStats.topReceiver ? (
                      <>
                        <span className="block my-1"><CopyableHash hash={summaryStats.topReceiver.address} /></span>
                        <span className="text-base font-black block mt-2">{summaryStats.topReceiver.txCountReceived.toLocaleString()} Received</span>
                      </>
                    ) : (
                      <span className="text-base font-black block mt-2 text-slate-400">N/A</span>
                    )}
                  </div>
                  <div className="bg-white border-2 border-black p-5 text-center space-y-1">
                    <span className="text-[9px] text-slate-600 font-extrabold uppercase tracking-widest block">Mean Tx USD Value</span>
                    <span className="font-mono text-xs text-slate-500 block my-1">Across all transfers</span>
                    <span className="text-base font-black block mt-2">
                      {summaryStats.meanTransferUsd != null
                        ? `$${summaryStats.meanTransferUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'swaps' && (
            <div className="space-y-10">
              <div className="border-b-2 border-black pb-4">
                <h2 className="text-2xl font-black uppercase text-black tracking-tight">Uniswap Live DEX Swaps</h2>
                <p className="text-xs text-slate-700 mt-1 font-bold">Simultaneous capture log of testnet swaps across active router addresses.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className="lg:col-span-2 brutalist-card p-6 flex flex-col justify-between h-[480px]">
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-4 text-black">
                      Live Pools Ingestion Stream
                    </h3>
                    <div className="space-y-3 overflow-y-auto max-h-[350px] pr-2 text-xs font-bold text-black">
                      {swapsList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[280px]">
                          <Repeat className="h-8 w-8 text-black animate-spin-slow mb-2" />
                          <span>Waiting for live DEX swapping ticks to resolve...</span>
                        </div>
                      ) : (
                        swapsList.map((s) => (
                          <div 
                            key={s.id} 
                            className="bg-white border border-black p-4 flex justify-between items-center hover:bg-slate-50 transition-colors duration-150"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center space-x-2">
                                <span className="border border-black bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase">
                                  {s.chainId === 11155111 ? 'Sepolia' : 'Base'}
                                </span>
                                <span className="text-black font-extrabold text-[10px] uppercase">{s.protocol} POOL</span>
                              </div>
                              <div>
                                Swapped <b>{parseFloat(s.amountInNormalized).toLocaleString()} {s.tokenInSymbol}</b> ➔ <b>{parseFloat(s.amountOutNormalized).toLocaleString()} {s.tokenOutSymbol}</b>
                              </div>
                            </div>

                            <div className="text-right space-y-1.5">
                              <span className="font-black block">${s.amountUsd?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '---'}</span>
                              <CopyableHash hash={s.txHash} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="brutalist-card p-6 h-[480px] flex flex-col justify-between">
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-6 text-black">
                      Active Pairs Aggregate %
                    </h3>
                    {swapPairData.length === 0 ? (
                      <div className="h-[250px] flex flex-col items-center justify-center text-xs font-bold text-slate-600 text-center px-4">
                        <Repeat className="h-8 w-8 text-black mb-2" />
                        <span>No swaps in the selected window yet</span>
                      </div>
                    ) : (
                      <>
                        <div className="h-[250px] flex items-center justify-center">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={swapPairData}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={70}
                                paddingAngle={5}
                                dataKey="value"
                              >
                                {swapPairData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{
                                  background: '#ffffff',
                                  border: '2px solid #000000',
                                  color: '#000000',
                                  borderRadius: '0px',
                                  fontSize: '11px',
                                  fontWeight: 'bold'
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-black uppercase">
                          {swapPairData.map((entry, index) => (
                            <div key={`${entry.name}-${index}`} className="flex items-center space-x-1.5">
                              <span className="h-2.5 w-2.5 border border-black" style={{ background: COLORS[index % COLORS.length] }} />
                              <span>{entry.name} ({entry.value}%)</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'nfts' && (
            <div className="space-y-10">
              <div className="border-b-2 border-black pb-4">
                <h2 className="text-2xl font-black uppercase text-black tracking-tight">NFT Collection Logs</h2>
                <p className="text-xs text-slate-700 mt-1 font-bold">Live testnet transfer registry mapping ERC-721 token distributions.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className="lg:col-span-2 brutalist-card p-6 flex flex-col justify-between h-[480px]">
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-4 text-black">
                      Live NFT Collectible Sales & Mints
                    </h3>
                    <div className="space-y-3 overflow-y-auto max-h-[350px] pr-2 text-xs font-bold text-black">
                      {nftsList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[280px]">
                          <Layers className="h-8 w-8 text-black animate-pulse mb-2" />
                          <span>Awaiting collectible sales index registries...</span>
                        </div>
                      ) : (
                        nftsList.map((n) => (
                          <div 
                            key={n.id} 
                            className="bg-white border border-black p-4 flex justify-between items-center hover:bg-slate-50 transition-colors duration-150"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center space-x-2">
                                <span className="border border-black bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase">
                                  {n.chainId === 11155111 ? 'Sepolia' : 'Base'}
                                </span>
                                <span className="border border-black bg-black text-white px-2 py-0.5 text-[9px] font-black uppercase">{n.typeLabel}</span>
                              </div>
                              <div>
                                🖼️ <b>{n.collectionName} ({n.collectionSymbol})</b> Token ID <b>#{n.tokenId}</b>
                              </div>
                            </div>

                            <div className="text-right space-y-1.5">
                              <span className="font-extrabold block">Qty: {n.amount}</span>
                              <CopyableHash hash={n.txHash} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="brutalist-card p-6 h-[480px] flex flex-col justify-between">
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-6 text-black">
                      Collection Valuation aggregated
                    </h3>
                    <div className="space-y-4 text-black overflow-y-auto max-h-[380px] pr-2">
                      {nftCollections.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[280px] text-xs font-bold text-slate-600 text-center px-4">
                          <Layers className="h-8 w-8 text-black mb-2" />
                          <span>No indexed NFT collections yet</span>
                        </div>
                      ) : (
                        nftCollections.map((c) => (
                          <div key={`${c.chainId}-${c.contractAddress}`} className="bg-white border-2 border-black p-4 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-slate-600 font-extrabold uppercase block">
                                {c.chainId === 11155111 ? 'Sepolia' : 'Base'} {c.name || c.symbol || 'Collection'}
                              </span>
                              <span className="text-[8px] font-black uppercase border border-black px-1.5 py-0.5 bg-slate-200">{c.symbol || 'NFT'}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase mt-1">
                              <span>{c.mints.toLocaleString()} Mints</span>
                              <span>{c.transfers.toLocaleString()} Sales</span>
                            </div>
                            <span className="text-base font-black block mt-1">{c.total.toLocaleString()} Total Events</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-10">
              <div className="border-b-2 border-black pb-4">
                <h2 className="text-2xl font-black uppercase text-black tracking-tight">Alert Architect builder</h2>
                <p className="text-xs text-slate-700 mt-1 font-bold">Configure reorg limits and whale thresholds to dispatch Telegram notifications.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                <div className="brutalist-card p-6 h-[550px] flex flex-col justify-between text-black">
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-6 text-black flex items-center space-x-2">
                      <Plus className="h-4 w-4" />
                      <span>Assemble New Alert Rule</span>
                    </h3>
                    
                    <form onSubmit={handleCreateRule} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black uppercase block">Rule Title</label>
                        <input 
                          type="text"
                          required
                          placeholder="e.g. USDC Mega Whale Alert"
                          value={newRuleName}
                          onChange={(e) => setNewRuleName(e.target.value)}
                          className="w-full px-4 py-2.5 brutalist-input focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black uppercase block">Trigger Type</label>
                          <select 
                            value={newRuleType}
                            onChange={(e: any) => setNewRuleType(e.target.value)}
                            className="w-full px-4 py-2.5 brutalist-input cursor-pointer"
                          >
                            <option value="WHALE">WHALE ALERT</option>
                            <option value="REORG">REORG EVENT</option>
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black uppercase block">Target Chain</label>
                          <select 
                            value={newRuleChain}
                            onChange={(e: any) => setNewRuleChain(parseInt(e.target.value))}
                            className="w-full px-4 py-2.5 brutalist-input cursor-pointer"
                          >
                            <option value="11155111">Ethereum Sepolia</option>
                            <option value="84532">Base Sepolia</option>
                          </select>
                        </div>
                      </div>

                      {newRuleType === 'WHALE' && (
                        <>
                          <div className="space-y-1.5">
                            <label className="text-[9px] font-black uppercase block">Token Address (Optional)</label>
                            <input 
                              type="text"
                              placeholder="0x... (empty triggers all)"
                              value={newRuleToken}
                              onChange={(e) => setNewRuleToken(e.target.value)}
                              className="w-full px-4 py-2.5 brutalist-input focus:outline-none"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[9px] font-black uppercase block">USD Threshold ($)</label>
                            <input 
                              type="number"
                              placeholder="e.g. 50000"
                              value={newRuleThreshold}
                              onChange={(e) => setNewRuleThreshold(e.target.value)}
                              className="w-full px-4 py-2.5 brutalist-input focus:outline-none"
                            />
                          </div>
                        </>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black uppercase block">Telegram ChatID</label>
                        <input 
                          type="text"
                          placeholder="e.g. @chainscope_whale"
                          value={newRuleTelegram}
                          onChange={(e) => setNewRuleTelegram(e.target.value)}
                          className="w-full px-4 py-2.5 brutalist-input focus:outline-none"
                        />
                      </div>

                      <button 
                        type="submit"
                        className="w-full py-3 mt-4 brutalist-button text-xs font-black cursor-pointer"
                      >
                        Create Alert Architect Rule
                      </button>
                    </form>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  
                  <div className="brutalist-card p-6 max-h-[265px] overflow-y-auto">
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-4 text-black flex items-center space-x-2">
                      <Bell className="h-4 w-4" />
                      <span>Active Architect Rules</span>
                    </h3>
                    <div className="space-y-3 font-bold text-black">
                      {rules.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 bg-white border border-black text-xs">
                          No active alert rules captured yet.
                        </div>
                      ) : (
                        rules.map((r) => (
                          <div 
                            key={r.id} 
                            className="bg-white border-2 border-black p-4 flex justify-between items-center hover:bg-slate-50 transition-colors"
                          >
                            <div className="space-y-1.5">
                              <span className="font-black block">{r.name}</span>
                              <div className="flex items-center space-x-2 text-[10px] text-slate-600">
                                <span className="border border-black bg-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase">{r.type}</span>
                                <span>Chain: {r.chainId === 11155111 ? 'Ethereum' : 'Base'}</span>
                                {r.type === 'WHALE' && <span>Threshold: ${r.thresholdUsd?.toLocaleString() || '0'}</span>}
                              </div>
                            </div>

                            <button 
                              onClick={() => handleDeleteRule(r.id)}
                              className="p-2 text-black hover:bg-black hover:text-white border-2 border-transparent hover:border-black transition-all cursor-pointer"
                              title="Delete Rule"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="brutalist-card p-6 max-h-[265px] overflow-y-auto">
                    <h3 className="font-black text-xs uppercase tracking-wider pb-3 border-b-2 border-black mb-4 text-black flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>Audit Logs of dispatched alerts</span>
                    </h3>
                    <div className="space-y-3 font-bold text-black">
                      {alertLogs.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 bg-white border border-black text-xs">
                          No notifications compiled yet. Waiting for triggers...
                        </div>
                      ) : (
                        alertLogs.map((l) => (
                          <div key={l.id} className="bg-white border-2 border-black p-4 flex justify-between items-center hover:bg-slate-50 transition-colors">
                            <div className="space-y-1.5">
                              <div className="flex items-center space-x-2">
                                <span className="font-black">{l.ruleName}</span>
                                <span className="border border-black bg-slate-200 px-1.5 py-0.5 text-[8px] font-black uppercase flex items-center space-x-0.5">
                                  <CheckCircle className="h-2.5 w-2.5" />
                                  <span>{l.status}</span>
                                </span>
                              </div>
                              <p className="text-slate-700 font-mono text-[10px] mt-1 bg-slate-50 p-2 border border-black">{l.message}</p>
                            </div>
                            <span className="text-[10px] text-slate-400 font-semibold">{new Date(l.createdAt).toLocaleTimeString()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
