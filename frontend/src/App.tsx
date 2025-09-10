import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import { Layout, Menu, Image } from 'antd';

import TestCaseEvaluation from './TestCaseEvaluation';

import logo from './logo.jpg'

const { Header, Content, Footer } = Layout;

const App: React.FC = () => {
    return (
        <Router>
            <Layout style={{ minHeight: '100vh' }}>                        
            <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <Image
                                src={logo}
                                alt="App Logo"
                                preview={false}
                                style={{ height: '40px', width: '40px', borderRadius: '50%', marginRight: '16px' }}
                            />
                            <h2 style={{ margin: 0, color: 'white', fontSize: '20px' }}>
                                LEXARA
                            </h2>
                        </div>
                    </div>
            </Header>
             
                <Content style={{ padding: '2rem' }}>
                    <Routes>
                        <Route path="*" element={<TestCaseEvaluation />} />                        
                    </Routes>
                </Content>
                <Footer style={{ backgroundColor:'#001628'}}> 
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center'}}>
                    <Image 
                        src="https://logos-world.net/wp-content/uploads/2021/10/Tableau-Symbol.png" 
                        alt="Logo" 
                        preview={false} 
                        style={{ height: '32px' }} 
                        />
                    <span style={{ margin: 0, marginLeft: 16, color: 'white', fontSize: '18px'}}>Powered by Tableau Research</span>
                    </div>
                </Footer>
            </Layout>
        </Router>
    );
};

export default App;
