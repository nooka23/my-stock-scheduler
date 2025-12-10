'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

type Profile = {
  id: string;
  email: string;
  nickname: string;
  is_approved: boolean;
  is_admin: boolean; 
  created_at: string;
};

export default function AdminPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  const [users, setUsers] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAdminAndFetchUsers();
  }, []);

  const checkAdminAndFetchUsers = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      router.push('/');
      return;
    }

    const { data: myProfile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .single();

    if (!myProfile || !myProfile.is_admin) {
      alert("접근 권한이 없습니다 (관리자 전용).");
      router.push('/');
      return;
    }

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setUsers(data);
    setIsLoading(false);
  };

  const toggleApprove = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.from('profiles').update({ is_approved: !currentStatus }).eq('id', id);
    if (!error) setUsers(users.map(u => u.id === id ? { ...u, is_approved: !currentStatus } : u));
  };

  const toggleAdmin = async (id: string, currentStatus: boolean) => {
    if (confirm(currentStatus ? "관리자 권한을 해제하시겠습니까?" : "이 회원을 관리자로 임명하시겠습니까?")) {
      const { error } = await supabase.from('profiles').update({ is_admin: !currentStatus }).eq('id', id);
      if (!error) setUsers(users.map(u => u.id === id ? { ...u, is_admin: !currentStatus } : u));
    }
  };

  if (isLoading) return <div className="p-10 text-center">로딩 중...</div>;

  return (
    <div className="h-full bg-gray-50 p-10 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-blue-800">👮 관리자 페이지</h1>
        </div>

        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="p-4 text-sm font-bold text-gray-600">닉네임 (이메일)</th>
                <th className="p-4 text-sm font-bold text-gray-600">가입 승인</th>
                <th className="p-4 text-sm font-bold text-gray-600">관리자 권한</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b hover:bg-gray-50">
                  <td className="p-4">
                    <div className="font-bold text-gray-800">{user.nickname || "닉네임 없음"}</div>
                    <div className="text-xs text-gray-500">{user.email}</div>
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => toggleApprove(user.id, user.is_approved)}
                      className={`px-3 py-1 rounded text-xs font-bold text-white ${user.is_approved ? 'bg-green-500' : 'bg-gray-400'}`}
                    >
                      {user.is_approved ? "승인됨" : "승인 대기"}
                    </button>
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => toggleAdmin(user.id, user.is_admin)}
                      className={`px-3 py-1 rounded text-xs font-bold border ${
                        user.is_admin 
                          ? 'bg-blue-100 text-blue-700 border-blue-300' 
                          : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      {user.is_admin ? "관리자 (해제)" : "일반 회원 (임명)"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}