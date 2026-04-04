import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import CreateTask from "./pages/CreateTask";
import TaskDetail from "./pages/TaskDetail";
import MyTasks from "./pages/MyTasks";
import AgentMonitor from "./pages/AgentMonitor";
import NotFound from "./pages/NotFound";
import { HackathonLayout } from "@/hackathon/HackathonLayout";
import HackathonIndex from "@/hackathon/pages/HackathonIndex";
import LiveEvent from "@/hackathon/pages/LiveEvent";
import Submissions from "@/hackathon/pages/Submissions";
import AgentPipeline from "@/hackathon/pages/AgentPipeline";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout><Dashboard /></AppLayout>} />
          <Route path="/create" element={<AppLayout><CreateTask /></AppLayout>} />
          <Route path="/task/:id" element={<AppLayout><TaskDetail /></AppLayout>} />
          <Route path="/tasks" element={<AppLayout><MyTasks /></AppLayout>} />
          <Route path="/agents" element={<AppLayout><AgentMonitor /></AppLayout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
