/**
 * Main Application Component
 * 
 * This is the root component of the Language Model Comparison App (Lexara).
 * It provides the main layout structure with header, content area, and footer.
 * The app uses React Router for navigation and Ant Design for UI components.
 * 
 * @author Research Team
 */

import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import { Layout, Menu, Image } from 'antd';

import TestCaseEvaluation from './TestCaseEvaluation';
import logo from './logo.jpg'

const { Header, Content, Footer } = Layout;

/**
 * Main App component that renders the application layout
 * 
 * @returns JSX element containing the complete application structure
 */
const App: React.FC = () => {
    return (
        <Router>
            <Layout style={{ minHeight: '100vh' }}>
                {/* Application Header with Logo and Title */}
                <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <Image
                                src={logo}
                                alt="Lexara Application Logo"
                                preview={false}
                                style={{ height: '40px', width: '40px', borderRadius: '50%', marginRight: '16px' }}
                            />
                            <h2 style={{ margin: 0, color: 'white', fontSize: '20px' }}>
                                LEXARA
                            </h2>
                        </div>
                    </div>
                </Header>
             
                {/* Main Content Area */}
                <Content style={{ padding: '2rem' }}>
                    <Routes>
                        {/* Default route renders the main evaluation component */}
                        <Route path="*" element={<TestCaseEvaluation />} />                        
                    </Routes>
                </Content>
                
                {/* Application Footer with Attribution */}
                <Footer style={{ backgroundColor:'#001628'}}> 
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center'}}>
                        <span style={{ margin: 0, marginLeft: 16, color: 'white', fontSize: '18px'}}>
                            Powered by Research
                        </span>
                    </div>
                </Footer>
            </Layout>
        </Router>
    );
};

export default App;
