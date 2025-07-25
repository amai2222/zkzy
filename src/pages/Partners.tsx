import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Partner } from '@/types';
import { Trash2, Edit, Plus, Download, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function Partners() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerProjects, setPartnerProjects] = useState<Record<string, any[]>>({});
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    taxRate: 0,
  });

  useEffect(() => {
    fetchPartners();
    fetchPartnerProjects();
  }, []);

  const fetchPartners = async () => {
    try {
      const { data, error } = await supabase
        .from('partners')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;

      const formattedData: Partner[] = data.map(item => ({
        id: item.id,
        name: item.name,
        taxRate: Number(item.tax_rate),
        createdAt: item.created_at,
      }));

      setPartners(formattedData);
    } catch (error) {
      console.error('获取合作方失败:', error);
      toast.error('获取合作方失败');
    }
  };

  const fetchPartnerProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('project_partners')
        .select(`
          partner_id,
          level,
          tax_rate,
          projects (
            id,
            name,
            auto_code
          )
        `);

      if (error) throw error;

      const projectsByPartner: Record<string, any[]> = {};
      data.forEach(item => {
        if (!projectsByPartner[item.partner_id]) {
          projectsByPartner[item.partner_id] = [];
        }
        projectsByPartner[item.partner_id].push({
          projectId: item.projects?.id,
          projectName: item.projects?.name,
          projectCode: item.projects?.auto_code,
          level: item.level,
          taxRate: Number(item.tax_rate)
        });
      });

      setPartnerProjects(projectsByPartner);
    } catch (error) {
      console.error('获取合作方项目关联失败:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('请输入合作方名称');
      return;
    }

    if (formData.taxRate < 0 || formData.taxRate >= 1) {
      toast.error('税点必须在0-1之间');
      return;
    }

    try {
      const partnerData = {
        name: formData.name.trim(),
        tax_rate: formData.taxRate,
      };

      if (editingPartner) {
        const { error } = await supabase
          .from('partners')
          .update(partnerData)
          .eq('id', editingPartner.id);

        if (error) throw error;
        toast.success('合作方更新成功');
      } else {
        const { error } = await supabase
          .from('partners')
          .insert([partnerData]);

        if (error) throw error;
      toast.success('合作方添加成功');
      }

      setIsDialogOpen(false);
      setEditingPartner(null);
      setFormData({ name: '', taxRate: 0 });
      fetchPartners();
      fetchPartnerProjects();
    } catch (error: any) {
      console.error('保存合作方失败:', error);
      if (error.code === '23505') {
        toast.error('合作方名称已存在');
      } else {
        toast.error('保存合作方失败');
      }
    }
  };

  const handleEdit = (partner: Partner) => {
    setEditingPartner(partner);
    setFormData({
      name: partner.name,
      taxRate: partner.taxRate,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个合作方吗？')) return;

    try {
      const { error } = await supabase
        .from('partners')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('合作方删除成功');
      fetchPartners();
      fetchPartnerProjects();
    } catch (error) {
      console.error('删除合作方失败:', error);
      toast.error('删除合作方失败');
    }
  };

  const exportToExcel = () => {
    const exportData = partners.map(partner => ({
      '合作方名称': partner.name,
      '默认税点': (partner.taxRate * 100).toFixed(2) + '%',
      '创建时间': new Date(partner.createdAt).toLocaleDateString(),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '合作方数据');
    XLSX.writeFile(wb, `合作方数据_${new Date().toLocaleDateString()}.xlsx`);
    toast.success('导出成功');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const importData = jsonData.map((row: any) => ({
          name: row['合作方名称'] || row['name'] || '',
          tax_rate: parseFloat((row['默认税点'] || row['税点'] || row['taxRate'] || '0').toString().replace('%', '')) / 100,
        }));

        // 验证数据
        const validData = importData.filter(item => 
          item.name && 
          item.tax_rate >= 0 && 
          item.tax_rate < 1
        );

        if (validData.length === 0) {
          toast.error('没有有效的数据可导入');
          return;
        }

        // 检查重复
        const existingNames = partners.map(p => p.name);
        const newData = validData.filter(item => !existingNames.includes(item.name));

        if (newData.length === 0) {
          toast.error('所有合作方已存在');
          return;
        }

        const { error } = await supabase
          .from('partners')
          .insert(newData);

        if (error) throw error;

        toast.success(`成功导入 ${newData.length} 个合作方`);
        fetchPartners();
        fetchPartnerProjects();
      } catch (error) {
        console.error('导入失败:', error);
        toast.error('导入失败');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingPartner(null);
    setFormData({ name: '', taxRate: 0 });
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">合作方管理</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToExcel}>
            <Download className="h-4 w-4 mr-2" />
            导出
          </Button>
          <label className="cursor-pointer">
            <Button variant="outline" type="button">
              <Upload className="h-4 w-4 mr-2" />
              导入
            </Button>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImport}
              className="hidden"
            />
          </label>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                添加合作方
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingPartner ? '编辑合作方' : '添加合作方'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">合作方名称</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="请输入合作方名称"
                  />
                </div>
                <div>
                  <Label htmlFor="taxRate">默认税点 (0-1之间的小数)</Label>
                  <Input
                    id="taxRate"
                    type="number"
                    step="0.0001"
                    min="0"
                    max="0.9999"
                    value={formData.taxRate}
                    onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 0 })}
                    placeholder="例如：0.03 表示3%"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closeDialog}>
                    取消
                  </Button>
                  <Button type="submit">
                    {editingPartner ? '更新' : '添加'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>合作方列表</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>合作方名称</TableHead>
                <TableHead>默认税点</TableHead>
                <TableHead>关联项目</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((partner) => (
                <TableRow key={partner.id}>
                  <TableCell>{partner.name}</TableCell>
                  <TableCell>{(partner.taxRate * 100).toFixed(2)}%</TableCell>
                  <TableCell>
                    <div className="max-w-xs">
                      {(partnerProjects[partner.id] || []).length > 0 ? (
                        <div className="space-y-1">
                          {partnerProjects[partner.id].slice(0, 2).map((project, index) => (
                            <div key={index} className="text-xs">
                              <span className="font-mono text-blue-600">{project.projectCode}</span>
                              <span className="text-muted-foreground ml-1">({project.projectName})</span>
                              <span className="text-xs text-orange-600 ml-1">级别{project.level} 税点{(project.taxRate * 100).toFixed(2)}%</span>
                            </div>
                          ))}
                          {partnerProjects[partner.id].length > 2 && (
                            <div className="text-xs text-muted-foreground">
                              +{partnerProjects[partner.id].length - 2} 个项目
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">未关联项目</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{new Date(partner.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(partner)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(partner.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}